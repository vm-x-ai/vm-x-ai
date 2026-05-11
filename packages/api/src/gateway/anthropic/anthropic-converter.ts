import type {
  AnthropicContentBlock,
  AnthropicContentBlockParam,
  AnthropicMessage,
  AnthropicMessagesRequest,
  AnthropicMessagesResponse,
  AnthropicStopReason,
  AnthropicToolChoice,
} from './anthropic.types';
import type { CompletionRequestDto } from '../dto/completion-request.dto';

/**
 * Anthropic ↔ OpenAI converters. Live on the gateway so client code
 * written against Anthropic's `POST /v1/messages` can talk to VM-X
 * unchanged. We translate to OpenAI Chat Completions internally
 * because that's the format VM-X's routing/fallback/audit machinery
 * is built around.
 *
 * Conversion rules (kept narrow):
 *
 *   - `system` (top-level) → prepended `{role:'system', content}` message.
 *   - Content blocks:
 *       text → text content part
 *       image (base64) → `image_url` with a data: URL
 *       image (url)    → `image_url`
 *       document (PDF) → `file` content part
 *       tool_use       → assistant message with `tool_calls`
 *       tool_result    → tool message with `content`
 *       thinking       → preserved as a structured `__vmx_passthrough.thinking`
 *                        annotation on the assistant message and dropped from
 *                        the OpenAI body (no inline equivalent). Native
 *                        passthrough providers (Bedrock-Invoke for `format:
 *                        'anthropic'`) bypass this converter entirely.
 *   - tools → OpenAI function tools (`{type:'function', function:{name,...}}`).
 *             Anthropic server tools (web_search_*, code_execution_*, bash_*,
 *             text_editor_*, computer_*) are forwarded as opaque
 *             `__vmx_passthrough.server_tools` for native providers to
 *             re-attach; OpenAI-Chat-only providers will surface them as a
 *             400 from upstream rather than silently dropping.
 *   - stop_sequences → `stop`.
 *   - metadata.user_id → `user` (full structured `metadata` is also
 *     forwarded under `__vmx_passthrough.metadata`).
 *   - top_k, thinking, cache_control, service_tier, mcp_servers, container,
 *     betas → forwarded under `__vmx_passthrough.anthropic` so native
 *     providers can re-attach them when the wire format permits. The
 *     OpenAI body itself stays clean.
 *
 * Cache_control on individual content blocks is preserved on the wire
 * for native passthrough — the converter walks blocks and records each
 * cache breakpoint in `__vmx_passthrough.anthropic.cache_breakpoints`
 * keyed by message+block index, so the Bedrock-Invoke / native
 * Anthropic providers can re-attach them when re-serialising.
 *
 * Anything we don't recognise is dropped — surfaces as a 400 from the
 * downstream OpenAI provider rather than silently corrupting the request.
 */

type OpenAIMessageContent =
  | string
  | Array<
      | { type: 'text'; text: string }
      | {
          type: 'image_url';
          image_url: { url: string };
        }
      | {
          type: 'file';
          file: {
            file_data?: string;
            file_id?: string;
            filename?: string;
          };
        }
    >;

type OpenAIMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  // `null` is the explicit OpenAI-spec shape for an assistant message
  // whose only payload is `tool_calls` (no inline text).
  content?: OpenAIMessageContent | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
};

export type OpenAIChatCompletionsRequest = {
  model: string;
  messages: OpenAIMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string[];
  user?: string;
  stream?: boolean;
  tools?: Array<{
    type: 'function';
    function: {
      name: string;
      description?: string;
      parameters: Record<string, unknown>;
    };
  }>;
  tool_choice?:
    | 'auto'
    | 'none'
    | 'required'
    | { type: 'function'; function: { name: string } };
  /**
   * Carrier for fields we cannot express natively in OpenAI Chat
   * Completions but must preserve through the gateway pivot so
   * native-format providers (Bedrock-Invoke for `format: 'anthropic'`,
   * native AnthropicProvider) can re-attach them when re-serialising.
   *
   * Strict-OpenAI-only providers ignore it; the SDK upstream will
   * reject any unknown top-level field, so this lives on a nested
   * envelope the providers explicitly opt-in to read.
   */
  __vmx_passthrough?: PassthroughEnvelope;
};

export type PassthroughEnvelope = {
  anthropic?: AnthropicPassthrough;
};

export type AnthropicPassthrough = {
  /** Top-level `cache_control` on the request envelope. */
  cache_control?: AnthropicMessagesRequest['cache_control'];
  /** Extended thinking config — `{type, budget_tokens?, display?}`. */
  thinking?: AnthropicMessagesRequest['thinking'];
  /** `top_k` (Anthropic-specific; OpenAI has no equivalent). */
  top_k?: number;
  /** `service_tier` selection. */
  service_tier?: AnthropicMessagesRequest['service_tier'];
  /** Container config (beta). */
  container?: AnthropicMessagesRequest['container'];
  /** Full structured metadata (more than `user_id`). */
  metadata?: AnthropicMessagesRequest['metadata'];
  /** Server tools (`web_search_*`, `code_execution_*`, etc.). */
  server_tools?: Array<unknown>;
  /** Tool choice with extended fields (`disable_parallel_tool_use`). */
  tool_choice?: AnthropicToolChoice;
  /**
   * Cache breakpoints inside the content. Keyed by `message_index/block_index`
   * (assistant/system stripped to flat indices) so providers can find and
   * re-attach the markers without parsing the OpenAI body.
   */
  cache_breakpoints?: Array<{
    path: string;
    cache_control: { type: 'ephemeral'; ttl?: '5m' | '1h' };
  }>;
  /** System-level cache control if `system` is a TextBlock array with markers. */
  system_cache_breakpoints?: Array<{
    index: number;
    cache_control: { type: 'ephemeral'; ttl?: '5m' | '1h' };
  }>;
  /** Tool-level cache breakpoints (last marked tool fixes the cache prefix). */
  tool_cache_breakpoints?: Array<{
    index: number;
    cache_control: { type: 'ephemeral'; ttl?: '5m' | '1h' };
  }>;
  /**
   * Thinking blocks from prior assistant turns — preserved so a
   * follow-up turn can include the signed reasoning back in the
   * request (multi-turn extended thinking continuity).
   *
   * Keyed by message index in the OpenAI `messages[]` array.
   */
  prior_thinking?: Array<{
    message_index: number;
    blocks: Array<{
      type: 'thinking' | 'redacted_thinking';
      thinking?: string;
      data?: string;
      signature?: string;
    }>;
  }>;
  /**
   * `betas` array opt-ins (interleaved-thinking-2025-05-14,
   * compact-2026-01-12, files-api-2025-04-14, search-results-2025-06-09,
   * etc.). T9 closes the gap where these were doc-claimed but never
   * actually plumbed. Native-Anthropic / Bedrock-Invoke providers
   * surface them onto the wire; OpenAI-compat providers ignore.
   */
  betas?: string[];
  /** MCP connector — URL-based remote MCP servers. (T9) */
  mcp_servers?: AnthropicMessagesRequest['mcp_servers'];
  /** Server-side compaction / context-management edits. (T9) */
  context_management?: AnthropicMessagesRequest['context_management'];
  /** Inference geo (us / global). (T9) */
  inference_geo?: AnthropicMessagesRequest['inference_geo'];
};

/**
 * Returns the converted body typed as `CompletionRequestDto` so the
 * gateway controller can pass it to `CompletionService.completion()`
 * without further casting. Internally we build a narrower
 * `OpenAIChatCompletionsRequest` (only the fields VM-X actually
 * threads through), then cast at this boundary — the OpenAI SDK's
 * `ChatCompletionCreateParams` has many union variants we don't need
 * to model exhaustively. The cast is safe because every field we set
 * is structurally a subset of the SDK shape.
 */
export function anthropicRequestToOpenAI(
  req: AnthropicMessagesRequest
): CompletionRequestDto {
  const messages: OpenAIMessage[] = [];
  const passthrough: AnthropicPassthrough = {};

  if (req.system) {
    if (typeof req.system === 'string') {
      if (req.system) messages.push({ role: 'system', content: req.system });
    } else {
      const parts: string[] = [];
      const systemBreakpoints: NonNullable<
        AnthropicPassthrough['system_cache_breakpoints']
      > = [];
      req.system.forEach((block, index) => {
        if (block.type === 'text') {
          parts.push(block.text);
          if (block.cache_control) {
            systemBreakpoints.push({
              index,
              cache_control: block.cache_control,
            });
          }
        }
      });
      const systemText = parts.join('\n');
      if (systemText) messages.push({ role: 'system', content: systemText });
      if (systemBreakpoints.length > 0) {
        passthrough.system_cache_breakpoints = systemBreakpoints;
      }
    }
  }

  const messageBreakpoints: NonNullable<
    AnthropicPassthrough['cache_breakpoints']
  > = [];
  const priorThinking: NonNullable<AnthropicPassthrough['prior_thinking']> = [];

  req.messages.forEach((m, mIdx) => {
    const result = convertAnthropicMessage(m, mIdx);
    messages.push(...result.messages);
    if (result.cacheBreakpoints.length > 0) {
      messageBreakpoints.push(...result.cacheBreakpoints);
    }
    if (result.thinkingBlocks.length > 0) {
      priorThinking.push({
        message_index: messages.length - result.messages.length,
        blocks: result.thinkingBlocks,
      });
    }
  });

  if (messageBreakpoints.length > 0) {
    passthrough.cache_breakpoints = messageBreakpoints;
  }
  if (priorThinking.length > 0) {
    passthrough.prior_thinking = priorThinking;
  }

  const tools: OpenAIChatCompletionsRequest['tools'] = [];
  const serverTools: Array<unknown> = [];
  const toolBreakpoints: NonNullable<
    AnthropicPassthrough['tool_cache_breakpoints']
  > = [];

  req.tools?.forEach((t, idx) => {
    if ('input_schema' in t) {
      // Custom user-defined function tool.
      tools.push({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema as Record<string, unknown>,
        },
      });
      if (t.cache_control) {
        toolBreakpoints.push({ index: idx, cache_control: t.cache_control });
      }
    } else {
      // Server-side tool (web_search_*, code_execution_*, bash_*, text_editor_*, computer_*).
      // Preserve verbatim under passthrough; OpenAI-only providers will
      // surface a 400 from upstream rather than silently dropping.
      serverTools.push(t);
    }
  });

  if (serverTools.length > 0) {
    passthrough.server_tools = serverTools;
  }
  if (toolBreakpoints.length > 0) {
    passthrough.tool_cache_breakpoints = toolBreakpoints;
  }

  // Top-level Anthropic-only fields → passthrough envelope.
  if (req.cache_control) passthrough.cache_control = req.cache_control;
  if (req.thinking) passthrough.thinking = req.thinking;
  if (typeof req.top_k === 'number') passthrough.top_k = req.top_k;
  if (req.service_tier) passthrough.service_tier = req.service_tier;
  if (req.container !== undefined) passthrough.container = req.container;
  if (req.metadata) passthrough.metadata = req.metadata;
  // Capture full tool_choice (including `disable_parallel_tool_use`).
  if (req.tool_choice && hasExtendedToolChoiceFields(req.tool_choice)) {
    passthrough.tool_choice = req.tool_choice;
  }
  // T9: capture the Anthropic-only knobs the doc-comment promises but
  // earlier code never wired up.
  const reqExtras = req as AnthropicMessagesRequest & {
    betas?: unknown;
    mcp_servers?: AnthropicMessagesRequest['mcp_servers'];
    context_management?: AnthropicMessagesRequest['context_management'];
    inference_geo?: AnthropicMessagesRequest['inference_geo'];
  };
  if (Array.isArray(reqExtras.betas) && reqExtras.betas.length > 0) {
    passthrough.betas = reqExtras.betas.filter(
      (b): b is string => typeof b === 'string'
    );
  }
  if (reqExtras.mcp_servers && reqExtras.mcp_servers.length > 0) {
    passthrough.mcp_servers = reqExtras.mcp_servers;
  }
  if (reqExtras.context_management) {
    passthrough.context_management = reqExtras.context_management;
  }
  if (reqExtras.inference_geo) {
    passthrough.inference_geo = reqExtras.inference_geo;
  }

  const out: OpenAIChatCompletionsRequest = {
    model: req.model,
    messages,
    max_tokens: req.max_tokens,
    temperature: req.temperature,
    top_p: req.top_p,
    stop: req.stop_sequences,
    user: req.metadata?.user_id ?? undefined,
    stream: req.stream,
    tools: tools.length > 0 ? tools : undefined,
    tool_choice: convertToolChoice(req.tool_choice),
  };

  if (Object.keys(passthrough).length > 0) {
    out.__vmx_passthrough = { anthropic: passthrough };
  }

  return out as unknown as CompletionRequestDto;
}

function hasExtendedToolChoiceFields(choice: AnthropicToolChoice): boolean {
  if (
    choice.type === 'auto' ||
    choice.type === 'any' ||
    choice.type === 'tool'
  ) {
    return choice.disable_parallel_tool_use === true;
  }
  return false;
}

type ConvertedMessageBlock = {
  messages: OpenAIMessage[];
  cacheBreakpoints: NonNullable<AnthropicPassthrough['cache_breakpoints']>;
  thinkingBlocks: NonNullable<
    AnthropicPassthrough['prior_thinking']
  >[number]['blocks'];
};

function convertAnthropicMessage(
  m: AnthropicMessage,
  messageIndex: number
): ConvertedMessageBlock {
  const cacheBreakpoints: ConvertedMessageBlock['cacheBreakpoints'] = [];
  const thinkingBlocks: ConvertedMessageBlock['thinkingBlocks'] = [];

  if (typeof m.content === 'string') {
    return {
      messages: [{ role: m.role, content: m.content }],
      cacheBreakpoints,
      thinkingBlocks,
    };
  }

  // Multi-block content. tool_use → assistant tool_calls;
  // tool_result → standalone tool message; text/image stay inline.
  const inline: Exclude<OpenAIMessageContent, string> = [];
  const toolCalls: NonNullable<OpenAIMessage['tool_calls']> = [];
  const followups: OpenAIMessage[] = [];

  m.content.forEach((block: AnthropicContentBlockParam, blockIdx) => {
    // Capture cache_control on blocks that carry it. Thinking /
    // redacted_thinking blocks have no cache_control field, so the
    // `'cache_control' in block` narrowing already excludes them.
    if ('cache_control' in block && block.cache_control) {
      cacheBreakpoints.push({
        path: `messages[${messageIndex}].content[${blockIdx}]`,
        cache_control: block.cache_control,
      });
    }

    switch (block.type) {
      case 'text':
        inline.push({ type: 'text', text: block.text });
        break;
      case 'image': {
        const src = block.source;
        const url =
          src.type === 'base64'
            ? `data:${src.media_type};base64,${src.data}`
            : src.type === 'url'
            ? src.url
            : null;
        if (url) {
          inline.push({ type: 'image_url', image_url: { url } });
        }
        break;
      }
      case 'document': {
        const src = block.source;
        if (src.type === 'base64') {
          inline.push({
            type: 'file',
            file: {
              file_data: `data:${src.media_type};base64,${src.data}`,
              filename: block.title ?? undefined,
            },
          });
        } else if (src.type === 'text') {
          // Plain-text document → flatten into a text part with a header.
          const header = block.title ? `# ${block.title}\n\n` : '';
          inline.push({ type: 'text', text: `${header}${src.data}` });
        } else if (src.type === 'url') {
          inline.push({
            type: 'file',
            file: {
              file_data: src.url,
              filename: block.title ?? undefined,
            },
          });
        }
        // `content` (ContentBlockSource) variant: best-effort flatten.
        break;
      }
      case 'tool_use':
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input ?? {}),
          },
        });
        break;
      case 'tool_result': {
        const flattened = flattenToolResultContent(block.content);
        followups.push({
          role: 'tool',
          tool_call_id: block.tool_use_id,
          content: flattened,
        });
        break;
      }
      case 'thinking':
        thinkingBlocks.push({
          type: 'thinking',
          thinking: block.thinking,
          signature: block.signature,
        });
        break;
      case 'redacted_thinking':
        thinkingBlocks.push({
          type: 'redacted_thinking',
          data: block.data,
        });
        break;
      // Server-tool blocks (server_tool_use, web_search_tool_result,
      // code_execution_tool_result, etc.) and container_upload have no
      // OpenAI Chat Completions equivalent; we drop them from the OpenAI
      // body since they're only meaningful in a native-passthrough
      // round-trip. The native provider preserves them via
      // `request.body` directly, not through this converter.
      default:
        break;
    }
  });

  const out: OpenAIMessage[] = [];
  if (inline.length > 0 || toolCalls.length > 0) {
    // OpenAI's spec requires `content: null` (explicit) on assistant
    // messages that carry only `tool_calls` — many providers reject the
    // `undefined` form. We emit `null` when the assistant has tool calls
    // but no inline content.
    const isToolOnlyAssistant =
      m.role === 'assistant' && toolCalls.length > 0 && inline.length === 0;
    out.push({
      role: m.role,
      ...(inline.length > 0
        ? { content: inline }
        : isToolOnlyAssistant
        ? { content: null }
        : {}),
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    });
  }
  out.push(...followups);
  return { messages: out, cacheBreakpoints, thinkingBlocks };
}

function flattenToolResultContent(
  content: Extract<
    AnthropicContentBlockParam,
    { type: 'tool_result' }
  >['content']
): string {
  if (typeof content === 'string') return content;
  if (!content) return '';
  return content
    .map((c) => {
      if (c.type === 'text') return c.text;
      // Drop image/document/search_result/tool_reference inside tool_result
      // for the OpenAI pivot — they have no Chat Completions equivalent
      // inside a tool message. Native passthrough preserves them.
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function convertToolChoice(
  choice?: AnthropicToolChoice
): OpenAIChatCompletionsRequest['tool_choice'] {
  if (!choice) return undefined;
  switch (choice.type) {
    case 'auto':
      return 'auto';
    case 'none':
      return 'none';
    case 'any':
      return 'required';
    case 'tool':
      return { type: 'function', function: { name: choice.name } };
  }
}

// ─── Response side ──────────────────────────────────────────────────────

type OpenAIChatCompletionsResponse = {
  id: string;
  model?: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string | null;
      refusal?: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
      /**
       * Anthropic-only extension surfaced by native passthrough providers
       * (Bedrock-Invoke, future native AnthropicProvider) so reasoning
       * survives the OpenAI Chat Completions pivot. Strict OpenAI clients
       * ignore the field; the converter reads it to reconstruct the
       * thinking content blocks for `format: 'anthropic'` responses.
       */
      reasoning?: {
        thinking?: string;
        signature?: string;
        redacted?: string[];
      };
    };
    finish_reason?: string;
    /**
     * Anthropic stop_details surfaced via OpenAI extension by native
     * passthrough providers. Carries refusal categorisation that
     * `finish_reason: 'content_filter'` alone can't express.
     */
    stop_details?: AnthropicMessagesResponse['stop_details'];
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: {
      cached_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_creation?: AnthropicMessagesResponse['usage']['cache_creation'];
    };
    /**
     * Server tool counts forwarded by native Anthropic-side providers
     * (Bedrock-Invoke, future native AnthropicProvider). Used to
     * round-trip `usage.server_tool_use` in `format: 'anthropic'`
     * responses.
     */
    server_tool_use?: AnthropicMessagesResponse['usage']['server_tool_use'];
  };
};

/**
 * Build a `Message` from an OpenAI Chat Completions response.
 *
 * Lossy by construction — the OpenAI body is the source of truth
 * here, so cache_creation tokens, server_tool_use counts, citations,
 * and stop_details (refusal category) cannot be recovered. When the
 * upstream provider returns a native Anthropic response (Bedrock-Invoke
 * with `format: 'anthropic'` passthrough, native AnthropicProvider),
 * this converter is bypassed entirely — the native body flows back
 * unchanged.
 */
export function openAIResponseToAnthropic(
  resp: OpenAIChatCompletionsResponse,
  modelOverride?: string
): AnthropicMessagesResponse {
  const choice = resp.choices?.[0];
  const content: AnthropicContentBlock[] = [];

  // Reconstruct thinking blocks first — Anthropic returns thinking
  // before text, so order matters for multi-turn continuity (clients
  // forward the response back unchanged in the next turn).
  const reasoning = choice?.message?.reasoning;
  if (reasoning?.redacted) {
    for (const data of reasoning.redacted) {
      content.push({ type: 'redacted_thinking', data });
    }
  }
  if (reasoning?.thinking) {
    content.push({
      type: 'thinking',
      thinking: reasoning.thinking,
      signature: reasoning.signature ?? '',
    });
  }

  const text = choice?.message?.content;
  if (typeof text === 'string' && text.length > 0) {
    content.push({ type: 'text', text, citations: null });
  }
  for (const tc of choice?.message?.tool_calls ?? []) {
    let parsedInput: Record<string, unknown> = {};
    try {
      parsedInput = tc.function.arguments
        ? JSON.parse(tc.function.arguments)
        : {};
    } catch {
      // Leave as empty object — provider returned malformed JSON args.
    }
    content.push({
      type: 'tool_use',
      id: tc.id,
      name: tc.function.name,
      input: parsedInput,
      caller: { type: 'direct' },
    });
  }

  const refusalText = choice?.message?.refusal;
  const stopReason = openAIFinishToAnthropicStop(
    choice?.finish_reason,
    refusalText
  );
  const ptd = resp.usage?.prompt_tokens_details;

  return {
    id: resp.id,
    type: 'message',
    role: 'assistant',
    container: null,
    model: modelOverride ?? resp.model ?? '',
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    stop_details:
      // Prefer the explicit stop_details forwarded by the native
      // provider (carries the refusal `category`); fall back to a
      // synthesised one when only the OpenAI `refusal` text survived.
      choice?.stop_details ??
      (stopReason === 'refusal'
        ? {
            type: 'refusal',
            category: null,
            explanation: refusalText ?? null,
          }
        : null),
    usage: {
      input_tokens: resp.usage?.prompt_tokens ?? 0,
      output_tokens: resp.usage?.completion_tokens ?? 0,
      cache_creation_input_tokens: ptd?.cache_creation_input_tokens ?? null,
      cache_read_input_tokens: ptd?.cached_tokens ?? null,
      cache_creation: ptd?.cache_creation ?? null,
      server_tool_use: resp.usage?.server_tool_use ?? null,
      service_tier: null,
      inference_geo: null,
    },
  };
}

function openAIFinishToAnthropicStop(
  reason: string | undefined,
  refusal?: string | null
): AnthropicStopReason | null {
  if (refusal) return 'refusal';
  switch (reason) {
    case 'stop':
      return 'end_turn';
    case 'length':
      return 'max_tokens';
    case 'tool_calls':
    case 'function_call':
      return 'tool_use';
    case 'content_filter':
      return 'refusal';
    default:
      return reason ? 'end_turn' : null;
  }
}
