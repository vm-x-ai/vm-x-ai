import { Injectable } from '@nestjs/common';
import type {
  Response as OpenAIResponse,
  ResponseCreateParams,
  ResponseInputItem,
  ResponseInputContent,
  ResponseStreamEvent,
  Tool as ResponsesTool,
} from 'openai/resources/responses/responses.js';
import { dispatchAnthropicMessagesViaOpenAIResponses } from './anthropic-via-responses';
import type {
  ContentBlock as AnthropicContentBlock,
  ContentBlockParam as AnthropicContentBlockParam,
  Message as AnthropicMessage,
  MessageParam as AnthropicMessageParam,
  RawMessageStreamEvent,
  TextBlockParam,
} from '@anthropic-ai/sdk/resources/messages';
import { v4 as uuidv4 } from 'uuid';
import { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import {
  AnthropicMessagesResponse,
  CompletionRequestOptions,
} from '../ai-provider.types';
import type {
  AnthropicMessagesRequest,
  AnthropicTool,
  AnthropicToolChoice,
} from '../../gateway/anthropic/anthropic.types';
import { OpenAIResponseProvider } from './openai-response.provider';
import { CompletionError } from '../../gateway/completion.types';
import type { OpenAIConnectionConfig } from './shared';
import { reasoningBudgetToEffort } from '../adapters/anthropic-reasoning';
import {
  classifyAnthropicServerTool,
  isServerToolHistoryBlock,
  liftAnthropicServerToolBlockToText,
  raiseUnsupportedServerTool,
} from '../adapters/anthropic-server-tools';
import type { ToolUnion as AnthropicToolUnion } from '@anthropic-ai/sdk/resources/messages';

/**
 * OpenAI provider's handler for Anthropic Messages input — D5
 * implementation: pivots through OpenAI **Responses** (not Chat
 * Completions) for richer cross-format fidelity.
 *
 * The adapter functions live at the top of this file (canonical owner
 * for Anthropic ↔ Responses conversion when the wire is OpenAI). Three
 * pure functions plus the `@Injectable` provider class:
 *
 *   Request  Anthropic → Responses
 *     system → instructions
 *     messages
 *       text content   → input_text
 *       image content  → input_image
 *       tool_use       → function_call item
 *       tool_result    → function_call_output item
 *       thinking       → reasoning item
 *     tools (custom)   → function tools
 *     tool_choice      → tool_choice
 *     temperature, top_p → same
 *     max_tokens       → max_output_tokens
 *     stop_sequences   → stop
 *     thinking.budget  → reasoning.effort tier
 *
 *   Response  Response → AnthropicMessage
 *     output[]
 *       message → text content blocks
 *       function_call → tool_use block
 *       reasoning → thinking block
 *     usage.input_tokens / output_tokens → input_tokens / output_tokens
 *     status → stop_reason (completed / tool_use → end_turn,
 *                           incomplete → max_tokens)
 *
 *   Stream  ResponseStreamEvent → RawMessageStreamEvent
 *     response.created → buffer for synthetic message_start
 *     response.output_item.added (message/function_call/reasoning)
 *       → content_block_start (with synthetic message_start on first)
 *     response.output_text.delta → content_block_delta (text_delta)
 *     response.function_call_arguments.delta → content_block_delta
 *                                              (input_json_delta)
 *     response.reasoning_summary_text.delta → content_block_delta
 *                                             (thinking_delta)
 *     response.output_item.done → content_block_stop
 *     response.completed → message_delta + message_stop with usage
 */

// ─── Request side ──────────────────────────────────────────────────

export function requestAnthropicToResponses(
  req: AnthropicMessagesRequest
): ResponseCreateParams {
  const inputItems: ResponseInputItem[] = [];

  for (const m of req.messages) {
    appendAnthropicMessageToResponses(inputItems, m);
  }

  const out: ResponseCreateParams = {
    model: req.model,
    input: inputItems as ResponseCreateParams['input'],
  };

  // System → instructions. Anthropic's `system` is `string` or
  // `TextBlockParam[]`; flatten to a single string for `instructions`.
  if (typeof req.system === 'string' && req.system.length > 0) {
    out.instructions = req.system;
  } else if (Array.isArray(req.system)) {
    const parts: string[] = [];
    for (const block of req.system as TextBlockParam[]) {
      if (block.type === 'text' && block.text) parts.push(block.text);
    }
    if (parts.length > 0) out.instructions = parts.join('\n');
  }

  if (typeof req.temperature === 'number') out.temperature = req.temperature;
  if (typeof req.top_p === 'number') out.top_p = req.top_p;
  if (typeof req.max_tokens === 'number')
    out.max_output_tokens = req.max_tokens;
  // ResponseCreateParams has no `stop` field — Anthropic's
  // `stop_sequences` is dropped on this conversion path. Forward via
  // `__vmx_passthrough` if a future native provider opts in.
  // `top_k` is Anthropic-only and dropped for the same reason.
  if (req.stream) {
    (out as ResponseCreateParams & { stream?: boolean }).stream = true;
  }

  // Anthropic `metadata.user_id` → Responses `safety_identifier`
  // (the modern replacement for the deprecated `user` field). Without
  // this the abuse-detection identifier is silently dropped on the
  // Anthropic-input path.
  if (req.metadata?.user_id) {
    out.safety_identifier = req.metadata.user_id;
  }

  // Anthropic `service_tier` (`auto` | `standard_only` | …) maps onto
  // Responses' tier enum where the labels overlap. Anthropic-only
  // values (`standard_only`) collapse to `default`; unknown values
  // are dropped so the SDK doesn't 400 on an unrecognised enum.
  const tier = mapAnthropicServiceTierToResponses(
    req.service_tier as string | null | undefined
  );
  if (tier) out.service_tier = tier;

  // Tools — custom function tools plus the subset of Anthropic
  // server tools that have a native Responses analogue (web_search,
  // code_interpreter). Server tools without a parallel reject with a
  // per-target 400 so customers see the gap explicitly.
  const tools = mapAnthropicToolsToResponses(
    req.tools as AnthropicToolUnion[] | undefined
  );
  if (tools && tools.length > 0) {
    out.tools = tools;
    if (req.tool_choice) {
      const tc = mapAnthropicToolChoiceToResponses(req.tool_choice);
      if (tc) out.tool_choice = tc;
    }
    // Anthropic encodes parallel-tool-call control on the `tool_choice`
    // object (`disable_parallel_tool_use`). Responses uses a top-level
    // `parallel_tool_calls` boolean — surface the gate so multi-tool
    // turns the caller explicitly serialised stay serial.
    if (
      req.tool_choice &&
      'disable_parallel_tool_use' in req.tool_choice &&
      req.tool_choice.disable_parallel_tool_use === true
    ) {
      out.parallel_tool_calls = false;
    }
  }

  if (req.thinking?.type === 'enabled' && req.thinking.budget_tokens != null) {
    out.reasoning = {
      effort: reasoningBudgetToEffort(req.thinking.budget_tokens),
    };
  }

  return out;
}

function mapAnthropicServiceTierToResponses(
  tier: string | null | undefined
): ResponseCreateParams['service_tier'] | undefined {
  if (!tier) return undefined;
  switch (tier) {
    case 'auto':
      return 'auto';
    case 'standard_only':
    case 'standard':
      return 'default';
    case 'priority':
      return 'priority';
    case 'batch':
      // Responses has no `batch` tier; `flex` is the closest analogue
      // for cost-optimised throughput-class workloads.
      return 'flex';
    default:
      return undefined;
  }
}

function appendAnthropicMessageToResponses(
  out: ResponseInputItem[],
  m: AnthropicMessageParam
): void {
  if (typeof m.content === 'string') {
    // OpenAI Responses uses `output_text` for assistant content and
    // `input_text` for user content. Anthropic's role-tagged messages
    // map directly.
    out.push({
      type: 'message',
      role: m.role as 'user' | 'assistant',
      content: [
        {
          type: m.role === 'assistant' ? 'output_text' : 'input_text',
          text: m.content,
        },
      ] as ResponseInputContent[],
    } as ResponseInputItem);
    return;
  }

  // Walk content blocks splitting them into three buckets:
  //   - `priorReasoning`: thinking / redacted_thinking → reasoning items.
  //     T16: these go BEFORE the assistant message so the model sees
  //     its own prior signed reasoning as context, matching the order
  //     the previous comment promised but the older code didn't honour.
  //   - `messageContent`: text / image → parts of an assistant message.
  //   - `trailingFollowups`: tool_use → function_call, tool_result →
  //     function_call_output. These naturally come AFTER the message
  //     they belong to.
  const priorReasoning: ResponseInputItem[] = [];
  const messageContent: ResponseInputContent[] = [];
  const trailingFollowups: ResponseInputItem[] = [];
  for (const block of m.content as AnthropicContentBlockParam[]) {
    switch (block.type) {
      case 'text':
        messageContent.push({
          type: m.role === 'assistant' ? 'output_text' : 'input_text',
          text: block.text,
        } as ResponseInputContent);
        break;
      case 'image': {
        const img = anthropicImageBlockToInputImage(block.source);
        if (img) messageContent.push(img as ResponseInputContent);
        break;
      }
      case 'tool_use':
        trailingFollowups.push({
          type: 'function_call',
          id: `fc_${block.id}`,
          call_id: block.id,
          name: block.name,
          arguments: JSON.stringify(block.input ?? {}),
          status: 'completed',
        } as unknown as ResponseInputItem);
        break;
      case 'tool_result': {
        // Responses' `function_call_output.output` accepts either a
        // plain string or an array of `input_text` / `input_image` /
        // `input_file` content items. Anthropic's `tool_result.content`
        // can be a string OR an array of text/image/document/etc. blocks
        // — flattening everything to text would drop the image(s) the
        // tool returned. Preserve the array shape whenever there's a
        // non-text part; otherwise fall back to the cheaper string form.
        const output = mapAnthropicToolResultContentToResponses(block.content);
        trailingFollowups.push({
          type: 'function_call_output',
          call_id: block.tool_use_id,
          output,
        } as ResponseInputItem);
        break;
      }
      case 'thinking':
        // Pin the prior reasoning as a Responses `reasoning` item;
        // signature round-trips via `encrypted_content` (T2) so
        // Anthropic's multi-turn signed-thinking validator accepts
        // the next call. T16: pushed onto `priorReasoning` so it
        // emits BEFORE the assistant message, matching the contract
        // the original comment advertised.
        priorReasoning.push({
          type: 'reasoning',
          id: `rs_${uuidv4()}`,
          summary: [{ type: 'summary_text', text: block.thinking ?? '' }],
          ...(block.signature ? { encrypted_content: block.signature } : {}),
        } as unknown as ResponseInputItem);
        break;
      case 'redacted_thinking':
        priorReasoning.push({
          type: 'reasoning',
          id: `rs_${uuidv4()}`,
          summary: [],
          encrypted_content: `__vmx_redacted__:${block.data}`,
        } as unknown as ResponseInputItem);
        break;
      default:
        // Server-tool history blocks (web_search_tool_result,
        // *_code_execution_tool_result, server_tool_use, etc.) have no
        // Responses-side input slot. Lift to a plain text content
        // part so the model keeps prior tool-invocation context.
        if (isServerToolHistoryBlock(block)) {
          const lifted = liftAnthropicServerToolBlockToText(block);
          if (lifted) {
            messageContent.push({
              type: m.role === 'assistant' ? 'output_text' : 'input_text',
              text: lifted.text,
            } as ResponseInputContent);
          }
        }
        break;
    }
  }

  for (const r of priorReasoning) out.push(r);
  if (messageContent.length > 0) {
    out.push({
      type: 'message',
      role: m.role as 'user' | 'assistant',
      content: messageContent,
    } as ResponseInputItem);
  }
  for (const f of trailingFollowups) out.push(f);
}

type AnthropicImageSource = Extract<
  AnthropicContentBlockParam,
  { type: 'image' }
>['source'];

/**
 * Build the Responses-shape `input_image` content item for an Anthropic
 * image source. Returns `null` for source kinds we don't yet map
 * (e.g. `file` references), letting the caller drop the part.
 */
function anthropicImageBlockToInputImage(
  src: AnthropicImageSource
): { type: 'input_image'; image_url: string } | null {
  if (src.type === 'base64') {
    return {
      type: 'input_image',
      image_url: `data:${src.media_type};base64,${src.data}`,
    };
  }
  if (src.type === 'url') {
    return { type: 'input_image', image_url: src.url };
  }
  return null;
}

/**
 * Convert an Anthropic `tool_result.content` value to the
 * Responses `function_call_output.output` shape.
 *
 * The Responses API accepts either a plain string or an array of
 * `input_text` / `input_image` / `input_file` content items. We
 * preserve the array form whenever the tool result contains a
 * non-text block (image, etc.) so multimodal tool outputs survive
 * the conversion; for the common text-only case we fold to a string
 * to keep the wire payload simple.
 */
type AnthropicToolResultContent = Extract<
  AnthropicContentBlockParam,
  { type: 'tool_result' }
>['content'];

function mapAnthropicToolResultContentToResponses(
  content: AnthropicToolResultContent
):
  | string
  | Array<
      | { type: 'input_text'; text: string }
      | { type: 'input_image'; image_url: string }
    > {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  type OutItem =
    | { type: 'input_text'; text: string }
    | { type: 'input_image'; image_url: string };
  const items: OutItem[] = [];
  let hasNonText = false;
  for (const c of content) {
    if (c.type === 'text') {
      items.push({ type: 'input_text', text: c.text ?? '' });
    } else if (c.type === 'image') {
      const img = anthropicImageBlockToInputImage(c.source);
      if (img) {
        items.push(img);
        hasNonText = true;
      }
    }
    // Other block kinds (document, search_result, tool_reference) have
    // no Responses-side equivalent yet — drop them, mirroring the
    // previous behaviour for non-text array entries.
  }

  if (!hasNonText) {
    return items.map((i) => (i.type === 'input_text' ? i.text : '')).join('');
  }
  return items;
}

function mapAnthropicToolsToResponses(
  tools?: AnthropicToolUnion[]
): ResponsesTool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  const out: ResponsesTool[] = [];
  const unsupported: string[] = [];
  for (const t of tools) {
    const family = classifyAnthropicServerTool(t);
    switch (family) {
      case 'custom': {
        const ct = t as AnthropicTool;
        // Anthropic's `Tool` and Responses' `FunctionTool` agree on
        // `name`, `description`, `strict`, and `defer_loading` — forward
        // them verbatim instead of hard-coding nulls. `strict` defaults
        // to `null` so the upstream's own default applies when the
        // caller didn't set one (Anthropic: false-ish, Responses: true).
        // Other Anthropic-side knobs (`cache_control`, `allowed_callers`,
        // `eager_input_streaming`, `input_examples`, `type: 'custom'`)
        // have no Responses-side equivalent and are dropped.
        const fn: ResponsesTool = {
          type: 'function',
          name: ct.name,
          description: ct.description ?? null,
          parameters: ct.input_schema as Record<string, unknown>,
          strict: ct.strict ?? null,
        };
        if (ct.defer_loading != null) {
          (fn as ResponsesTool & { defer_loading?: boolean }).defer_loading =
            ct.defer_loading;
        }
        out.push(fn);
        break;
      }
      case 'web_search': {
        // Anthropic's `user_location` mirrors Responses 1:1 (city /
        // country / region / timezone). `allowed_domains` projects
        // onto Responses' `filters.allowed_domains`. `blocked_domains`
        // has no Responses-side analogue and is dropped.
        const w = t as {
          user_location?: {
            type?: 'approximate';
            city?: string | null;
            country?: string | null;
            region?: string | null;
            timezone?: string | null;
          } | null;
          allowed_domains?: string[] | null;
        };
        const tool: ResponsesTool = { type: 'web_search' } as ResponsesTool;
        if (w.user_location) {
          (
            tool as ResponsesTool & {
              user_location?: Record<string, unknown>;
            }
          ).user_location = {
            city: w.user_location.city ?? null,
            country: w.user_location.country ?? null,
            region: w.user_location.region ?? null,
            timezone: w.user_location.timezone ?? null,
          };
        }
        if (w.allowed_domains && w.allowed_domains.length > 0) {
          (
            tool as ResponsesTool & {
              filters?: { allowed_domains?: string[] };
            }
          ).filters = { allowed_domains: w.allowed_domains };
        }
        out.push(tool);
        break;
      }
      case 'code_execution': {
        // Responses' `code_interpreter` requires a `container` — the
        // sandbox the model writes / runs code in. Default to the
        // auto-container so the gateway doesn't force callers to
        // pre-provision one (Anthropic's surface is similarly
        // managed-server-side).
        out.push({
          type: 'code_interpreter',
          container: { type: 'auto' },
        } as ResponsesTool);
        break;
      }
      default:
        unsupported.push((t as { type?: string }).type ?? family);
    }
  }
  if (unsupported.length > 0) {
    raiseUnsupportedServerTool(unsupported, 'openai_responses');
  }
  return out.length > 0 ? out : undefined;
}

function mapAnthropicToolChoiceToResponses(
  choice: AnthropicToolChoice
): ResponseCreateParams['tool_choice'] | undefined {
  switch (choice.type) {
    case 'auto':
      return 'auto';
    case 'any':
      return 'required';
    case 'tool':
      return {
        type: 'function',
        name: choice.name,
      } as ResponseCreateParams['tool_choice'];
    case 'none':
      // T11: OpenAI Responses honours `'none'` as a literal string —
      // mapping it explicitly preserves the Anthropic semantic
      // (model must not call any tool) instead of silently letting
      // tools remain callable.
      return 'none';
    default:
      return undefined;
  }
}

// ─── Response side (non-streaming) ─────────────────────────────────

export function responseResponsesToAnthropic(
  resp: OpenAIResponse,
  model: string
): AnthropicMessage {
  const content: AnthropicContentBlockParam[] = [];

  for (const item of resp.output ?? []) {
    if (item.type === 'message') {
      // Each message item → one or more text blocks (one per
      // output_text content part). `refusal` parts surface as plain
      // text so multi-turn flows keep the refusal context visible —
      // Anthropic has no `refusal` ContentBlock, so the symmetric
      // mapping is the same one used by the reverse adapter.
      for (const part of (
        item as {
          content?: Array<{ type?: string; text?: string; refusal?: string }>;
        }
      ).content ?? []) {
        if (part.type === 'output_text' && typeof part.text === 'string') {
          content.push({
            type: 'text',
            text: part.text,
            citations: null,
          } as AnthropicContentBlockParam);
        } else if (
          part.type === 'refusal' &&
          typeof part.refusal === 'string'
        ) {
          content.push({
            type: 'text',
            text: part.refusal,
            citations: null,
          } as AnthropicContentBlockParam);
        }
      }
    } else if (item.type === 'function_call') {
      const call = item as {
        type: 'function_call';
        call_id?: string;
        id: string;
        name: string;
        arguments: string;
      };
      let parsed: Record<string, unknown> = {};
      try {
        parsed = call.arguments ? JSON.parse(call.arguments) : {};
      } catch {
        parsed = {};
      }
      content.push({
        type: 'tool_use',
        id: call.call_id ?? call.id,
        name: call.name,
        input: parsed,
        caller: { type: 'direct' },
      } as unknown as AnthropicContentBlockParam);
    } else if (item.type === 'reasoning') {
      const r = item as {
        type: 'reasoning';
        summary?: Array<{ type?: string; text?: string }>;
        encrypted_content?: string;
      };
      // `encrypted_content` carries the Anthropic signature (or, with
      // a sentinel prefix, the `redacted_thinking` data blob). When
      // the field is absent we fall back to the legacy empty-signature
      // shape — the model and downstream caller still see a
      // `thinking` block, just without multi-turn continuity.
      if (
        typeof r.encrypted_content === 'string' &&
        r.encrypted_content.startsWith('__vmx_redacted__:')
      ) {
        content.push({
          type: 'redacted_thinking',
          data: r.encrypted_content.slice('__vmx_redacted__:'.length),
        } as AnthropicContentBlockParam);
      } else {
        const text = (r.summary ?? [])
          .filter((s) => s.type === 'summary_text')
          .map((s) => s.text ?? '')
          .join('\n');
        if (text || r.encrypted_content) {
          content.push({
            type: 'thinking',
            thinking: text,
            signature: r.encrypted_content ?? '',
          });
        }
      }
    }
  }

  const stopReason = mapResponseStatusToStopReason(resp);

  const u = resp.usage as
    | (OpenAIResponse['usage'] & {
        input_tokens_details?: {
          cached_tokens?: number;
          cache_creation_input_tokens?: number;
        };
        output_tokens_details?: { reasoning_tokens?: number };
      })
    | undefined;
  const usage = u
    ? {
        // SDK 0.95.1 `Usage` has eight fields — all must be present
        // (with nulls where unknown) so downstream consumers that
        // dereference e.g. `usage.cache_creation` don't NPE on the
        // OpenAI-pivoted shape.
        cache_creation: null,
        cache_creation_input_tokens:
          u.input_tokens_details?.cache_creation_input_tokens ?? null,
        cache_read_input_tokens: u.input_tokens_details?.cached_tokens ?? null,
        inference_geo: null,
        input_tokens: u.input_tokens,
        output_tokens: u.output_tokens,
        server_tool_use: null,
        service_tier: null,
        // T15: surface OpenAI Responses' `output_tokens_details.reasoning_tokens`
        // on the Anthropic-shape usage so cost-tracking + audit
        // pipelines see the real reasoning-token spend. The detail
        // sub-object is OpenAI's nested shape; preserve it so
        // downstream code can read either the flat extension or the
        // nested form.
        ...(u.output_tokens_details?.reasoning_tokens != null
          ? {
              output_tokens_details: {
                reasoning_tokens: u.output_tokens_details.reasoning_tokens,
              },
            }
          : {}),
      }
    : undefined;

  return {
    id: resp.id,
    type: 'message',
    role: 'assistant',
    model,
    content: content as AnthropicContentBlock[],
    container: null,
    stop_reason: stopReason,
    stop_sequence: null,
    stop_details: null,
    ...(usage ? { usage } : {}),
  } as unknown as AnthropicMessage;
}

function mapResponseStatusToStopReason(
  resp: OpenAIResponse
): AnthropicMessage['stop_reason'] {
  if (resp.status === 'incomplete') {
    const inc = (resp as { incomplete_details?: { reason?: string } | null })
      .incomplete_details;
    // T6: distinguish max-tokens truncation from content-filter
    // refusals — both come back as `incomplete` but mean very
    // different things to the Anthropic-shaped consumer.
    if (inc?.reason === 'max_output_tokens') return 'max_tokens';
    if (inc?.reason === 'content_filter') return 'refusal';
    return 'max_tokens';
  }
  const hasToolCall = (resp.output ?? []).some(
    (item) => item.type === 'function_call'
  );
  if (hasToolCall) return 'tool_use';
  return 'end_turn';
}

// ─── Stream side ───────────────────────────────────────────────────

export async function* streamResponsesToAnthropic(
  source: AsyncIterable<ResponseStreamEvent>,
  model: string
): AsyncIterable<RawMessageStreamEvent> {
  let messageStartEmitted = false;
  let messageId = `msg_${uuidv4()}`;
  // Per Responses output_index → { kind, anthropic block index }.
  const indexMap = new Map<
    number,
    {
      kind: 'text' | 'tool_use' | 'thinking';
      anthropicIndex: number;
      callId?: string;
      name?: string;
    }
  >();
  let nextAnthropicIndex = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadInput: number | null = null;
  let cacheCreationInput: number | null = null;
  let stopReason: AnthropicMessage['stop_reason'] = 'end_turn';

  const emitMessageStart = (): RawMessageStreamEvent | null => {
    if (messageStartEmitted) return null;
    messageStartEmitted = true;
    return {
      type: 'message_start',
      message: {
        id: messageId,
        type: 'message',
        role: 'assistant',
        model,
        content: [],
        container: null,
        stop_reason: null,
        stop_details: null,
        stop_sequence: null,
        usage: {
          cache_creation: null,
          cache_creation_input_tokens: null,
          cache_read_input_tokens: null,
          inference_geo: null,
          input_tokens: 0,
          output_tokens: 0,
          server_tool_use: null,
          service_tier: null,
        },
      },
    };
  };

  for await (const event of source) {
    const t = (event as { type?: string }).type;

    if (t === 'response.created') {
      const e = event as { response?: { id?: string } };
      if (e.response?.id) messageId = e.response.id;
      const start = emitMessageStart();
      if (start) yield start;
      continue;
    }
    if (t === 'response.in_progress') continue;

    if (t === 'response.output_item.added') {
      const e = event as {
        output_index?: number;
        item?: {
          type?: string;
          id?: string;
          call_id?: string;
          name?: string;
        };
      };
      const start = emitMessageStart();
      if (start) yield start;
      if (e.output_index == null || !e.item) continue;
      const ai = nextAnthropicIndex++;
      if (e.item.type === 'message') {
        // Text body — content_block_start happens on first text.delta
        // below; we record the slot now so the delta knows the index.
        indexMap.set(e.output_index, {
          kind: 'text',
          anthropicIndex: ai,
        });
        yield {
          type: 'content_block_start',
          index: ai,
          content_block: { type: 'text', text: '', citations: null },
        };
      } else if (e.item.type === 'function_call') {
        indexMap.set(e.output_index, {
          kind: 'tool_use',
          anthropicIndex: ai,
          callId: e.item.call_id ?? e.item.id,
          name: e.item.name,
        });
        yield {
          type: 'content_block_start',
          index: ai,
          content_block: {
            type: 'tool_use',
            id: e.item.call_id ?? e.item.id ?? '',
            name: e.item.name ?? '',
            input: {},
            caller: { type: 'direct' },
          },
        };
      } else if (e.item.type === 'reasoning') {
        indexMap.set(e.output_index, {
          kind: 'thinking',
          anthropicIndex: ai,
        });
        yield {
          type: 'content_block_start',
          index: ai,
          content_block: {
            type: 'thinking',
            thinking: '',
            signature: '',
          },
        };
      }
      continue;
    }

    if (t === 'response.content_part.added') continue;

    if (t === 'response.output_text.delta') {
      const e = event as { output_index?: number; delta?: string };
      if (e.output_index == null || e.delta == null) continue;
      const slot = indexMap.get(e.output_index);
      if (!slot) continue;
      yield {
        type: 'content_block_delta',
        index: slot.anthropicIndex,
        delta: { type: 'text_delta', text: e.delta },
      };
      continue;
    }

    if (t === 'response.function_call_arguments.delta') {
      const e = event as { output_index?: number; delta?: string };
      if (e.output_index == null || e.delta == null) continue;
      const slot = indexMap.get(e.output_index);
      if (!slot) continue;
      yield {
        type: 'content_block_delta',
        index: slot.anthropicIndex,
        delta: {
          type: 'input_json_delta',
          partial_json: e.delta,
        },
      };
      continue;
    }

    if (t === 'response.reasoning_summary_text.delta') {
      const e = event as { output_index?: number; delta?: string };
      if (e.output_index == null || e.delta == null) continue;
      const slot = indexMap.get(e.output_index);
      if (!slot) continue;
      yield {
        type: 'content_block_delta',
        index: slot.anthropicIndex,
        delta: { type: 'thinking_delta', thinking: e.delta },
      };
      continue;
    }

    if (t === 'response.refusal.delta') {
      // Anthropic has no `refusal` content block in the stream
      // protocol — surface refusal text as a plain `text_delta` so
      // multi-turn flows keep the refused content visible. Matches
      // the non-streaming converter's symmetric treatment of
      // `ResponseOutputRefusal`.
      const e = event as { output_index?: number; delta?: string };
      if (e.output_index == null || e.delta == null) continue;
      const slot = indexMap.get(e.output_index);
      if (!slot) continue;
      yield {
        type: 'content_block_delta',
        index: slot.anthropicIndex,
        delta: { type: 'text_delta', text: e.delta },
      };
      continue;
    }

    if (
      t === 'response.output_text.done' ||
      t === 'response.function_call_arguments.done' ||
      t === 'response.reasoning_summary_text.done' ||
      t === 'response.refusal.done' ||
      t === 'response.content_part.done'
    ) {
      // Anthropic doesn't emit per-part done — emit content_block_stop
      // on output_item.done below.
      continue;
    }

    if (t === 'response.output_item.done') {
      const e = event as {
        output_index?: number;
        item?: {
          type?: string;
          encrypted_content?: string;
        };
      };
      if (e.output_index == null) continue;
      const slot = indexMap.get(e.output_index);
      if (!slot) continue;
      // For reasoning items, signal the Anthropic-shape signature_delta
      // BEFORE content_block_stop — this restores multi-turn signed-
      // thinking continuity. The encrypted_content field carries the
      // signature when input was Anthropic, or whatever the upstream
      // emits when input was Responses.
      if (
        slot.kind === 'thinking' &&
        e.item?.type === 'reasoning' &&
        typeof e.item.encrypted_content === 'string' &&
        e.item.encrypted_content.length > 0 &&
        !e.item.encrypted_content.startsWith('__vmx_redacted__:')
      ) {
        yield {
          type: 'content_block_delta',
          index: slot.anthropicIndex,
          delta: {
            type: 'signature_delta',
            signature: e.item.encrypted_content,
          },
        };
      }
      yield {
        type: 'content_block_stop',
        index: slot.anthropicIndex,
      };
      continue;
    }

    if (t === 'response.completed') {
      const e = event as {
        response?: {
          status?: string;
          output?: Array<{ type?: string }>;
          incomplete_details?: { reason?: string } | null;
          usage?: {
            input_tokens?: number;
            output_tokens?: number;
            input_tokens_details?: {
              cached_tokens?: number;
              cache_creation_input_tokens?: number;
            };
          };
        };
      };
      const r = e.response;
      if (r?.usage) {
        inputTokens = r.usage.input_tokens ?? inputTokens;
        outputTokens = r.usage.output_tokens ?? outputTokens;
        cacheReadInput =
          r.usage.input_tokens_details?.cached_tokens ?? cacheReadInput;
        cacheCreationInput =
          r.usage.input_tokens_details?.cache_creation_input_tokens ??
          cacheCreationInput;
      }
      if (r) {
        const hasTool = (r.output ?? []).some(
          (o) => o.type === 'function_call'
        );
        if (r.status === 'incomplete') {
          // T6: keep refusal vs truncation distinct.
          stopReason =
            r.incomplete_details?.reason === 'content_filter'
              ? 'refusal'
              : 'max_tokens';
        } else if (hasTool) {
          stopReason = 'tool_use';
        } else {
          stopReason = 'end_turn';
        }
      }
      break;
    }

    if (t === 'response.incomplete') {
      // Truncation — preserve the OpenAI-side reason where possible.
      const e = event as {
        response?: { incomplete_details?: { reason?: string } | null };
      };
      stopReason =
        e.response?.incomplete_details?.reason === 'content_filter'
          ? 'refusal'
          : 'max_tokens';
      break;
    }

    if (t === 'response.failed') {
      // T6: don't pretend a real upstream failure was a token-budget
      // truncation. Throw so the caller's audit row + retry pipeline
      // sees a CompletionError, not a successful message_stop with
      // `stop_reason: 'max_tokens'`. Map to the gateway's standard
      // upstream-error shape.
      const e = event as {
        response?: {
          error?: { code?: string; message?: string } | null;
        };
      };
      const message =
        e.response?.error?.message ?? 'Responses stream failed mid-flight';
      throw new CompletionError({
        rate: false,
        retryable: true,
        statusCode: 502,
        message,
        failureReason: 'External API error',
        openAICompatibleError: {
          code: e.response?.error?.code ?? 'response_failed',
        },
      });
    }

    if (t === 'error') {
      // Standalone `error` event (not `response.failed`) — emitted when
      // the upstream itself reports a stream-level fault before the
      // response envelope is finalised. Same retry-eligible 502
      // mapping as `response.failed` so the audit row captures the
      // upstream code/message.
      const e = event as {
        code?: string | null;
        message?: string;
        param?: string | null;
      };
      throw new CompletionError({
        rate: false,
        retryable: true,
        statusCode: 502,
        message: e.message ?? 'Responses stream error event',
        failureReason: 'External API error',
        openAICompatibleError: {
          code: e.code ?? 'response_stream_error',
          param: e.param ?? null,
        },
      });
    }
  }

  yield {
    type: 'message_delta',
    delta: {
      container: null,
      stop_details: null,
      stop_reason: stopReason,
      stop_sequence: null,
    },
    usage: {
      cache_creation_input_tokens: cacheCreationInput,
      cache_read_input_tokens: cacheReadInput,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      server_tool_use: null,
    },
  };
  yield { type: 'message_stop' };
}

// ─── Provider class ────────────────────────────────────────────────

@Injectable()
export class OpenAIAnthropicMessagesProvider {
  constructor(private readonly responseProvider: OpenAIResponseProvider) {}

  handle(
    request: AnthropicMessagesRequest,
    connection: AIConnectionEntity<OpenAIConnectionConfig>,
    model: AIResourceModelConfigEntity,
    options?: CompletionRequestOptions
  ): Promise<AnthropicMessagesResponse> {
    return dispatchAnthropicMessagesViaOpenAIResponses(
      this.responseProvider,
      request,
      connection,
      model,
      options
    );
  }
}
