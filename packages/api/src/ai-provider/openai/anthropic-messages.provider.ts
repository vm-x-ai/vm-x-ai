import { Injectable } from '@nestjs/common';
import type {
  Response as OpenAIResponse,
  ResponseCreateParams,
  ResponseInputItem,
  ResponseInputContent,
  ResponseStreamEvent,
  Tool as ResponsesTool,
} from 'openai/resources/responses/responses.js';
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
  if (req.stream) {
    (out as ResponseCreateParams & { stream?: boolean }).stream = true;
  }

  // Tools (custom function tools only — server tools have no
  // ResponsesAPI-by-OpenAI native equivalent worth mapping in the
  // common case).
  const tools = mapAnthropicToolsToResponses(
    req.tools as AnthropicTool[] | undefined
  );
  if (tools && tools.length > 0) {
    out.tools = tools;
    if (req.tool_choice) {
      const tc = mapAnthropicToolChoiceToResponses(req.tool_choice);
      if (tc) out.tool_choice = tc;
    }
  }

  if (req.thinking?.type === 'enabled' && req.thinking.budget_tokens != null) {
    out.reasoning = { effort: budgetToEffort(req.thinking.budget_tokens) };
  }

  return out;
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
        const src = block.source;
        if (src.type === 'base64') {
          const dataUrl = `data:${src.media_type};base64,${src.data}`;
          messageContent.push({
            type: 'input_image',
            image_url: dataUrl,
          } as ResponseInputContent);
        } else if (src.type === 'url') {
          messageContent.push({
            type: 'input_image',
            image_url: src.url,
          } as ResponseInputContent);
        }
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
        const text =
          typeof block.content === 'string'
            ? block.content
            : Array.isArray(block.content)
            ? (block.content as Array<{ type?: string; text?: string }>)
                .filter((c) => c.type === 'text')
                .map((c) => c.text ?? '')
                .join('')
            : '';
        trailingFollowups.push({
          type: 'function_call_output',
          call_id: block.tool_use_id,
          output: text,
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

function mapAnthropicToolsToResponses(
  tools?: AnthropicTool[]
): ResponsesTool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools
    .map((t): ResponsesTool | null => {
      if (!('input_schema' in t)) return null;
      return {
        type: 'function',
        name: t.name,
        description: t.description ?? null,
        parameters: t.input_schema as Record<string, unknown>,
        strict: null,
      } as unknown as ResponsesTool;
    })
    .filter((t): t is ResponsesTool => t != null);
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

function budgetToEffort(budget: number): 'low' | 'medium' | 'high' {
  if (budget <= 2048) return 'low';
  if (budget <= 8192) return 'medium';
  return 'high';
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
      // output_text content part).
      for (const part of (
        item as { content?: Array<{ type?: string; text?: string }> }
      ).content ?? []) {
        if (part.type === 'output_text' && typeof part.text === 'string') {
          content.push({ type: 'text', text: part.text });
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
      });
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
        input_tokens: u.input_tokens,
        output_tokens: u.output_tokens,
        cache_read_input_tokens: u.input_tokens_details?.cached_tokens ?? null,
        cache_creation_input_tokens:
          u.input_tokens_details?.cache_creation_input_tokens ?? null,
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
        server_tool_use: null,
        service_tier: null,
      }
    : undefined;

  return {
    id: resp.id,
    type: 'message',
    role: 'assistant',
    model,
    content: content as AnthropicContentBlock[],
    stop_reason: stopReason,
    stop_sequence: null,
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
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: 0,
          output_tokens: 0,
        } as never,
      } as never,
    } as unknown as RawMessageStreamEvent;
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
          content_block: { type: 'text', text: '' } as never,
        } as unknown as RawMessageStreamEvent;
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
            id: e.item.call_id ?? e.item.id,
            name: e.item.name ?? '',
            input: {},
          } as never,
        } as unknown as RawMessageStreamEvent;
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
          } as never,
        } as unknown as RawMessageStreamEvent;
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
        delta: { type: 'text_delta', text: e.delta } as never,
      } as unknown as RawMessageStreamEvent;
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
        } as never,
      } as unknown as RawMessageStreamEvent;
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
        delta: { type: 'thinking_delta', thinking: e.delta } as never,
      } as unknown as RawMessageStreamEvent;
      continue;
    }

    if (
      t === 'response.output_text.done' ||
      t === 'response.function_call_arguments.done' ||
      t === 'response.reasoning_summary_text.done' ||
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
          } as never,
        } as unknown as RawMessageStreamEvent;
      }
      yield {
        type: 'content_block_stop',
        index: slot.anthropicIndex,
      } as unknown as RawMessageStreamEvent;
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
  }

  yield {
    type: 'message_delta',
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_read_input_tokens: cacheReadInput,
      cache_creation_input_tokens: cacheCreationInput,
      server_tool_use: null,
    } as never,
  } as unknown as RawMessageStreamEvent;
  yield { type: 'message_stop' } as unknown as RawMessageStreamEvent;
}

// ─── Provider class ────────────────────────────────────────────────

@Injectable()
export class OpenAIAnthropicMessagesProvider {
  constructor(private readonly responseProvider: OpenAIResponseProvider) {}

  async handle(
    request: AnthropicMessagesRequest,
    connection: AIConnectionEntity<OpenAIConnectionConfig>,
    model: AIResourceModelConfigEntity,
    options?: CompletionRequestOptions
  ): Promise<AnthropicMessagesResponse> {
    const responsesBody = requestAnthropicToResponses(request);
    const native = await this.responseProvider.handle(
      responsesBody,
      connection,
      model,
      options
    );

    if (
      native.data != null &&
      typeof (native.data as AsyncIterable<ResponseStreamEvent>)[
        Symbol.asyncIterator
      ] === 'function'
    ) {
      return {
        data: streamResponsesToAnthropic(
          native.data as AsyncIterable<ResponseStreamEvent>,
          model.model
        ),
        headers: native.headers,
        providerRequestPayload: native.providerRequestPayload,
      };
    }
    return {
      data: responseResponsesToAnthropic(
        native.data as OpenAIResponse,
        model.model
      ),
      headers: native.headers,
      providerRequestPayload: native.providerRequestPayload,
    };
  }
}
