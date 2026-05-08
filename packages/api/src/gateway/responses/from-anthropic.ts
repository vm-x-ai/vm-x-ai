import type {
  ContentBlockParam as AnthropicContentBlockParam,
  ImageBlockParam as AnthropicImageBlockParam,
  MessageParam as AnthropicMessageParam,
  TextBlockParam as AnthropicTextBlockParam,
  ToolUseBlockParam as AnthropicToolUseBlockParam,
  ToolResultBlockParam as AnthropicToolResultBlockParam,
  ThinkingBlockParam as AnthropicThinkingBlockParam,
  RedactedThinkingBlockParam as AnthropicRedactedThinkingBlockParam,
} from '@anthropic-ai/sdk/resources/messages';
import type {
  ResponseCreateParams,
  ResponseInputContent,
  ResponseInputItem,
  Tool as ResponsesTool,
} from 'openai/resources/responses/responses.js';
import type {
  AnthropicMessagesRequest,
  AnthropicTool,
  AnthropicToolChoice,
} from '../anthropic/anthropic.types';

/**
 * Convert an Anthropic Messages request body into a Responses request body.
 *
 * Used by the `/anthropic/messages` controller to normalize inbound traffic
 * to the gateway's canonical Responses shape before routing/gating/audit.
 * The original Anthropic body is threaded through as `originalGatewayRequest`
 * so the dispatch path can still emit Anthropic on the wire when the
 * resource resolves to a native Anthropic / Bedrock-Invoke provider.
 *
 * Mapping summary:
 *   model                    → model
 *   system (string or text-blocks) → instructions (concatenated)
 *   messages[user].content (text)            → input[].message(role:user) input_text
 *   messages[user].content (image)           → input[].message(role:user) input_image
 *   messages[user].content (tool_result)     → input[].function_call_output
 *   messages[assistant].content (text)       → input[].message(role:assistant) output_text
 *   messages[assistant].content (tool_use)   → input[].function_call
 *   messages[assistant].content (thinking)   → input[].reasoning + encrypted_content
 *   tools[] (function/custom) → tools[]   (type:'function')
 *   tools[] (web_search_*, code_execution_*, bash_*, text_editor_*, computer_*)
 *                            → __vmx_passthrough.anthropic.server_tools[]
 *   tool_choice              → tool_choice
 *   max_tokens               → max_output_tokens
 *   temperature, top_p       → same
 *   stream                   → stream
 *   metadata                 → __vmx_passthrough.anthropic.metadata
 *   thinking                 → reasoning (low/medium/high tier from budget)
 *                              + __vmx_passthrough.anthropic.thinking (verbatim)
 *   top_k                    → __vmx_passthrough.anthropic.top_k
 *   service_tier             → __vmx_passthrough.anthropic.service_tier
 *   betas                    → __vmx_passthrough.anthropic.betas
 *   mcp_servers              → __vmx_passthrough.anthropic.mcp_servers
 *   context_management       → __vmx_passthrough.anthropic.context_management
 *   inference_geo            → __vmx_passthrough.anthropic.inference_geo
 *   container                → __vmx_passthrough.anthropic.container
 *   per-block cache_control  → __vmx_passthrough.anthropic.cache_control / cache_breakpoints
 *   __vmx_passthrough        → __vmx_passthrough (merged with anthropic-side carry-overs)
 *   vmx                      → vmx (verbatim)
 */
export function anthropicToResponsesRequest(
  payload: AnthropicMessagesRequest
): ResponseCreateParams {
  const out: ResponseCreateParams = {
    model: payload.model,
    input: [],
  } as ResponseCreateParams;

  if (payload.system !== undefined && payload.system !== null) {
    const text = stringifyAnthropicSystem(payload.system);
    if (text) out.instructions = text;
  }

  const input: ResponseInputItem[] = [];
  for (const msg of payload.messages ?? []) {
    appendAnthropicMessage(input, msg);
  }
  out.input = input;

  if (typeof payload.temperature === 'number') {
    out.temperature = payload.temperature;
  }
  if (typeof payload.top_p === 'number') {
    out.top_p = payload.top_p;
  }
  if (typeof payload.max_tokens === 'number') {
    out.max_output_tokens = payload.max_tokens;
  }
  if (payload.stream) {
    (out as ResponseCreateParams & { stream?: boolean }).stream = true;
  }

  // Build __vmx_passthrough.anthropic side. Existing passthrough on the
  // payload (from the inbound `__vmx_passthrough` field) is preserved
  // first, then we layer Anthropic-only fields on top.
  const passthroughAnthropic: Record<string, unknown> = {};
  const inboundPassthrough = (
    payload as AnthropicMessagesRequest & {
      __vmx_passthrough?: Record<string, unknown>;
    }
  ).__vmx_passthrough;
  const inboundAnth = (inboundPassthrough?.anthropic ?? {}) as Record<
    string,
    unknown
  >;
  Object.assign(passthroughAnthropic, inboundAnth);

  // Extract per-block cache_control breakpoints into top-level
  // `system_cache_breakpoints` / `tool_cache_breakpoints` /
  // `messages_cache_breakpoints` so providers re-applying the envelope
  // don't have to re-walk the message tree.
  const sysBreakpoints = collectSystemCacheBreakpoints(payload.system);
  if (sysBreakpoints.length) {
    passthroughAnthropic.system_cache_breakpoints = sysBreakpoints;
  }
  const toolBreakpoints = collectToolCacheBreakpoints(payload.tools);
  if (toolBreakpoints.length) {
    passthroughAnthropic.tool_cache_breakpoints = toolBreakpoints;
  }
  const messageBreakpoints = collectMessageCacheBreakpoints(payload.messages);
  if (messageBreakpoints.length) {
    passthroughAnthropic.messages_cache_breakpoints = messageBreakpoints;
  }

  if ((payload as { thinking?: unknown }).thinking !== undefined) {
    passthroughAnthropic.thinking = (
      payload as { thinking?: unknown }
    ).thinking;
    // Map budget_tokens → effort tier so cross-provider routing has a
    // first-class signal. Anthropic-native dispatch reads the verbatim
    // `thinking` from the passthrough; non-Anthropic upstreams pick up
    // `reasoning.effort` as a coarse equivalent.
    const thinking = (
      payload as { thinking?: { type?: string; budget_tokens?: number } }
    ).thinking;
    const effort = budgetToEffort(thinking?.budget_tokens);
    if (effort) {
      out.reasoning = { effort } as ResponseCreateParams['reasoning'];
    }
  }

  if (typeof (payload as { top_k?: number }).top_k === 'number') {
    passthroughAnthropic.top_k = (payload as { top_k?: number }).top_k;
  }
  if ((payload as { service_tier?: string }).service_tier) {
    passthroughAnthropic.service_tier = (
      payload as { service_tier?: string }
    ).service_tier;
  }
  if ((payload as { metadata?: unknown }).metadata) {
    passthroughAnthropic.metadata = (
      payload as { metadata?: unknown }
    ).metadata;
  }
  if (payload.betas !== undefined) {
    passthroughAnthropic.betas = payload.betas;
  }
  if (payload.mcp_servers !== undefined) {
    passthroughAnthropic.mcp_servers = payload.mcp_servers;
  }
  if (payload.context_management !== undefined) {
    passthroughAnthropic.context_management = payload.context_management;
  }
  if (payload.inference_geo !== undefined) {
    passthroughAnthropic.inference_geo = payload.inference_geo;
  }
  if ((payload as { container?: unknown }).container !== undefined) {
    passthroughAnthropic.container = (
      payload as { container?: unknown }
    ).container;
  }
  if (typeof payload.stop_sequences !== 'undefined') {
    passthroughAnthropic.stop_sequences = payload.stop_sequences;
  }

  // Tools: function/custom tools → Responses function tools; everything
  // else (server tools, computer use, text editor, code execution, …)
  // rides on `__vmx_passthrough.anthropic.server_tools` so native
  // Anthropic dispatch can re-emit them onto the wire body.
  const { functionTools, serverTools } = partitionAnthropicTools(payload.tools);
  if (functionTools.length > 0) {
    out.tools = functionTools;
  }
  if (serverTools.length > 0) {
    passthroughAnthropic.server_tools = serverTools;
  }
  const toolChoice = mapToolChoice(payload.tool_choice);
  if (toolChoice !== undefined) {
    out.tool_choice = toolChoice;
  }

  // Stamp the assembled passthrough back onto the request body. Skip
  // when nothing was added so we don't litter empty envelopes.
  if (Object.keys(passthroughAnthropic).length > 0) {
    const merged: Record<string, unknown> = {
      ...(inboundPassthrough ?? {}),
      anthropic: passthroughAnthropic,
    };
    (
      out as ResponseCreateParams & { __vmx_passthrough?: unknown }
    ).__vmx_passthrough = merged;
  } else if (inboundPassthrough) {
    (
      out as ResponseCreateParams & { __vmx_passthrough?: unknown }
    ).__vmx_passthrough = inboundPassthrough;
  }

  // Carry vmx envelope through verbatim.
  const vmx = (payload as AnthropicMessagesRequest & { vmx?: unknown }).vmx;
  if (vmx !== undefined) {
    (out as ResponseCreateParams & { vmx?: unknown }).vmx = vmx;
  }

  return out;
}

function appendAnthropicMessage(
  input: ResponseInputItem[],
  msg: AnthropicMessageParam
): void {
  const role = msg.role;
  const content = msg.content;

  // String content shortcut.
  if (typeof content === 'string') {
    if (role === 'user') {
      input.push({
        type: 'message',
        role: 'user',
        content,
      } as ResponseInputItem);
    } else {
      // assistant text shortcut → output_text content. The Responses
      // SDK's type union for the assistant `content[]` field overlaps
      // the input/output union — cast through unknown so TS doesn't
      // try to narrow `'output_text'` against the input-only types.
      input.push({
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: content,
          } as unknown as ResponseInputContent,
        ],
      } as ResponseInputItem);
    }
    return;
  }

  if (!Array.isArray(content)) return;

  if (role === 'user') {
    appendAnthropicUserBlocks(input, content as AnthropicContentBlockParam[]);
    return;
  }
  appendAnthropicAssistantBlocks(
    input,
    content as AnthropicContentBlockParam[]
  );
}

function appendAnthropicUserBlocks(
  input: ResponseInputItem[],
  blocks: AnthropicContentBlockParam[]
): void {
  // tool_result blocks become standalone function_call_output items;
  // text + image blocks aggregate into a single user message.
  const messageContent: ResponseInputContent[] = [];

  for (const block of blocks) {
    if (block.type === 'tool_result') {
      // Flush any pending text/image content before the tool_result so
      // ordering stays stable.
      if (messageContent.length > 0) {
        input.push({
          type: 'message',
          role: 'user',
          content: messageContent.slice(),
        } as ResponseInputItem);
        messageContent.length = 0;
      }
      const tr = block as AnthropicToolResultBlockParam;
      input.push({
        type: 'function_call_output',
        call_id: tr.tool_use_id,
        output: stringifyAnthropicToolResult(tr.content),
      } as ResponseInputItem);
      continue;
    }
    if (block.type === 'text') {
      const t = block as AnthropicTextBlockParam;
      messageContent.push({
        type: 'input_text',
        text: t.text,
      } as ResponseInputContent);
      continue;
    }
    if (block.type === 'image') {
      const img = block as AnthropicImageBlockParam;
      const mapped = mapAnthropicImage(img);
      if (mapped) messageContent.push(mapped);
      continue;
    }
    // document / search_result / other input blocks: drop with no
    // Responses equivalent. Native Anthropic dispatch reads
    // originalGatewayRequest.body so the block survives end-to-end
    // when the resolved provider speaks Anthropic on the wire.
  }

  if (messageContent.length > 0) {
    input.push({
      type: 'message',
      role: 'user',
      content: messageContent,
    } as ResponseInputItem);
  }
}

function appendAnthropicAssistantBlocks(
  input: ResponseInputItem[],
  blocks: AnthropicContentBlockParam[]
): void {
  // Walk in order. text/thinking blocks aggregate into the assistant
  // message; tool_use blocks emit standalone function_call items.
  const messageContent: ResponseInputContent[] = [];
  const flush = () => {
    if (messageContent.length === 0) return;
    input.push({
      type: 'message',
      role: 'assistant',
      content: messageContent.slice(),
    } as ResponseInputItem);
    messageContent.length = 0;
  };

  for (const block of blocks) {
    if (block.type === 'text') {
      const t = block as AnthropicTextBlockParam;
      messageContent.push({
        type: 'output_text',
        text: t.text,
      } as unknown as ResponseInputContent);
      continue;
    }
    if (block.type === 'thinking') {
      // Reasoning items live as siblings of `message` items in input[],
      // not as content parts. Flush the message buffer, then emit a
      // reasoning item carrying the signature on `encrypted_content`.
      // The Responses SDK's `ResponseReasoningItem` requires `id`; we
      // synthesise a placeholder so the body validates — providers
      // re-emit the underlying signature on the wire.
      flush();
      const th = block as AnthropicThinkingBlockParam;
      const reasoningItem: ResponseInputItem & { encrypted_content?: string } =
        {
          type: 'reasoning',
          id: '',
          summary: [{ type: 'summary_text', text: th.thinking }],
        } as unknown as ResponseInputItem & { encrypted_content?: string };
      if (th.signature) reasoningItem.encrypted_content = th.signature;
      input.push(reasoningItem);
      continue;
    }
    if (block.type === 'redacted_thinking') {
      // Sentinel-prefix on encrypted_content lets the inverse converter
      // re-emit a `redacted_thinking` block on the way out.
      flush();
      const r = block as AnthropicRedactedThinkingBlockParam;
      const reasoningItem = {
        type: 'reasoning',
        id: '',
        summary: [],
        encrypted_content: `redacted:${r.data}`,
      } as unknown as ResponseInputItem;
      input.push(reasoningItem);
      continue;
    }
    if (block.type === 'tool_use') {
      flush();
      const tu = block as AnthropicToolUseBlockParam;
      input.push({
        type: 'function_call',
        call_id: tu.id,
        name: tu.name,
        arguments:
          typeof tu.input === 'string'
            ? tu.input
            : JSON.stringify(tu.input ?? {}),
      } as ResponseInputItem);
      continue;
    }
    // server_tool_use, web_search_tool_result, code_execution_tool_result,
    // etc. — drop here. They're emitted server-side by the model and
    // re-attached via __vmx_passthrough.anthropic.server_tools when the
    // native Anthropic dispatch path runs.
  }
  flush();
}

function mapAnthropicImage(
  img: AnthropicImageBlockParam
): ResponseInputContent | undefined {
  const source = img.source;
  if (!source) return undefined;
  if (source.type === 'base64') {
    return {
      type: 'input_image',
      image_url: `data:${source.media_type};base64,${source.data}`,
    } as ResponseInputContent;
  }
  if (source.type === 'url') {
    return {
      type: 'input_image',
      image_url: source.url,
    } as ResponseInputContent;
  }
  return undefined;
}

function stringifyAnthropicSystem(
  system: AnthropicMessagesRequest['system']
): string {
  if (typeof system === 'string') return system;
  if (!Array.isArray(system)) return '';
  return system
    .filter((b) => (b as { type?: string }).type === 'text')
    .map((b) => (b as AnthropicTextBlockParam).text)
    .join('\n\n');
}

function stringifyAnthropicToolResult(
  content: AnthropicToolResultBlockParam['content']
): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      const t = (part as { type?: string }).type;
      if (t === 'text') return (part as { text: string }).text;
      // image / non-text result content: serialize so the call_id
      // round-trips, even if the Responses path can't render it.
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function partitionAnthropicTools(tools: AnthropicMessagesRequest['tools']): {
  functionTools: ResponsesTool[];
  serverTools: AnthropicTool[];
} {
  const functionTools: ResponsesTool[] = [];
  const serverTools: AnthropicTool[] = [];
  if (!tools) return { functionTools, serverTools };
  for (const tool of tools) {
    const type = (tool as { type?: string }).type;
    // Function tools on Anthropic are `{ type: 'custom', name, description, input_schema }`
    // — also emitted by the SDK without a type when it's a plain custom tool.
    if (type === undefined || type === 'custom') {
      const fn = tool as {
        name: string;
        description?: string;
        input_schema?: Record<string, unknown>;
      };
      functionTools.push({
        type: 'function',
        name: fn.name,
        description: fn.description,
        parameters: (fn.input_schema ?? {}) as Record<string, unknown>,
        strict: null,
      } as ResponsesTool);
      continue;
    }
    // Hosted / server tools: web_search_20250305, code_execution_20250825,
    // computer_20250124, bash_20250124, text_editor_20250728, etc. Carry
    // them on the passthrough so native Anthropic dispatch re-emits them.
    serverTools.push(tool as AnthropicTool);
  }
  return { functionTools, serverTools };
}

function mapToolChoice(
  choice: AnthropicToolChoice | undefined
): ResponseCreateParams['tool_choice'] | undefined {
  if (!choice) return undefined;
  const type = (choice as { type?: string }).type;
  if (type === 'auto') return 'auto';
  if (type === 'any') return 'required';
  if (type === 'none') return 'none';
  if (type === 'tool') {
    const t = choice as { type: 'tool'; name: string };
    return {
      type: 'function',
      name: t.name,
    } as ResponseCreateParams['tool_choice'];
  }
  return undefined;
}

function budgetToEffort(
  budget: number | undefined
): 'low' | 'medium' | 'high' | undefined {
  if (typeof budget !== 'number') return undefined;
  if (budget < 2000) return 'low';
  if (budget < 8000) return 'medium';
  return 'high';
}

// ─── Cache breakpoint collectors ──────────────────────────────────────

type CacheBreakpoint = {
  index: number;
  ttl?: '5m' | '1h';
};

function collectSystemCacheBreakpoints(
  system: AnthropicMessagesRequest['system']
): CacheBreakpoint[] {
  if (!Array.isArray(system)) return [];
  const out: CacheBreakpoint[] = [];
  system.forEach((block, idx) => {
    const cc = (block as { cache_control?: { ttl?: '5m' | '1h' } | null })
      .cache_control;
    if (cc) out.push({ index: idx, ...(cc.ttl ? { ttl: cc.ttl } : {}) });
  });
  return out;
}

function collectToolCacheBreakpoints(
  tools: AnthropicMessagesRequest['tools']
): CacheBreakpoint[] {
  if (!tools) return [];
  const out: CacheBreakpoint[] = [];
  tools.forEach((tool, idx) => {
    const cc = (tool as { cache_control?: { ttl?: '5m' | '1h' } | null })
      .cache_control;
    if (cc) out.push({ index: idx, ...(cc.ttl ? { ttl: cc.ttl } : {}) });
  });
  return out;
}

function collectMessageCacheBreakpoints(
  messages: AnthropicMessageParam[] | undefined
): Array<CacheBreakpoint & { messageIndex: number; blockIndex: number }> {
  if (!messages) return [];
  const out: Array<
    CacheBreakpoint & { messageIndex: number; blockIndex: number }
  > = [];
  messages.forEach((msg, mi) => {
    if (typeof msg.content === 'string') return;
    if (!Array.isArray(msg.content)) return;
    msg.content.forEach((block, bi) => {
      const cc = (block as { cache_control?: { ttl?: '5m' | '1h' } | null })
        .cache_control;
      if (cc)
        out.push({
          messageIndex: mi,
          blockIndex: bi,
          index: bi,
          ...(cc.ttl ? { ttl: cc.ttl } : {}),
        });
    });
  });
  return out;
}
