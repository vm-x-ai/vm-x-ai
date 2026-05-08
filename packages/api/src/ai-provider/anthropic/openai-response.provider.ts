import { Injectable } from '@nestjs/common';
import type {
  Response as OpenAIResponse,
  ResponseCreateParams,
  ResponseInputContent,
  ResponseInputItem,
  ResponseOutputItem,
  ResponseStreamEvent,
  Tool as ResponsesTool,
} from 'openai/resources/responses/responses.js';
import type {
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
  CompletionRequestOptions,
  OpenAIResponseResponse,
} from '../ai-provider.types';
import type {
  AnthropicMessagesRequest,
  AnthropicTool,
} from '../../gateway/anthropic/anthropic.types';
import { AnthropicConnectionConfig, AnthropicDispatcher } from './shared';
import {
  applyPassthrough,
  applyStructuredOutputFromSchema,
} from '../adapters/anthropic-messages.adapter';
import { takePassthroughEnvelope } from '../passthrough.helpers';
import type { TextBlockParam as AnthropicTextBlockParam } from '@anthropic-ai/sdk/resources/messages';

/**
 * Anthropic's OpenAI-Responses input handler — direct one-pair
 * Responses ↔ Anthropic converter (no internal pivot through
 * ChatCompletion).
 *
 * The adapter functions live at the top of the file (pure, importable
 * by sibling provider folders that need the same conversion — today
 * `aws-bedrock-invoke/openai-response.provider.ts` is the only candidate
 * since Bedrock-Invoke speaks Anthropic on the wire too).
 *
 * Mapping summary:
 *
 *   Request  Responses → Anthropic
 *     instructions    → system (string)
 *     input (string)  → messages [{role:'user', content:string}]
 *     input (items)
 *       message       → messages entry
 *       function_call → assistant msg with tool_use block
 *       function_call_output → user msg with tool_result block
 *       reasoning     → recorded thinking block on previous assistant
 *     tools (function) → Anthropic custom tool
 *     tools (hosted, e.g. web_search) → server tool passthrough
 *     temperature, top_p, top_k → same
 *     max_output_tokens → max_tokens
 *     stop          → stop_sequences
 *     tool_choice   → tool_choice
 *     reasoning     → thinking config (effort → budget tier)
 *
 *   Response  Anthropic Message → Response
 *     content[]
 *       text          → output[] message → output_text part
 *       thinking      → output[] reasoning → summary text
 *       tool_use      → output[] function_call (call_id, name, args)
 *     usage           → usage (input_tokens / output_tokens / details)
 *     stop_reason     → status (end_turn / tool_use → completed,
 *                       max_tokens → incomplete, refusal → completed)
 *     model + id passthrough
 *
 *   Stream  Anthropic SSE → ResponseStreamEvent[]
 *     message_start → response.created + response.in_progress
 *     content_block_start (text) → output_item.added(message) +
 *                                  content_part.added(output_text)
 *     content_block_start (tool_use) → output_item.added(function_call)
 *     content_block_start (thinking) → output_item.added(reasoning)
 *     content_block_delta (text_delta) → output_text.delta
 *     content_block_delta (input_json_delta) → function_call_arguments.delta
 *     content_block_delta (thinking_delta) → reasoning_summary_text.delta
 *     content_block_stop → content_part.done + output_item.done
 *     message_delta (usage) → accumulate
 *     message_stop → response.completed
 *
 * Unsupported items / blocks raise a 400 from the Anthropic SDK rather
 * than silently dropping data — surfacing the gap is more useful than
 * a quiet truncation.
 */

// ─── Request side ──────────────────────────────────────────────────

export function requestResponsesToAnthropic(
  req: ResponseCreateParams
): AnthropicMessagesRequest {
  // Lift the `__vmx_passthrough.anthropic` envelope so we can re-apply
  // Anthropic-only fields the converter would otherwise drop on the
  // ground (cache_control, top_k, service_tier, metadata, container,
  // server tools, structured-output schema, tool_choice override). T7
  // closes the silent-fidelity gap audit-matrix flagged here.
  const { body: cleanReq, anthropic: passthrough } =
    takePassthroughEnvelope(req);
  const messages: AnthropicMessageParam[] = [];

  const inputItems: ResponseInputItem[] = Array.isArray(cleanReq.input)
    ? cleanReq.input
    : [
        {
          type: 'message',
          role: 'user',
          content: cleanReq.input ?? '',
        } as ResponseInputItem,
      ];

  for (const item of inputItems) {
    appendInputItem(messages, item);
  }

  const systemParts: AnthropicTextBlockParam[] = [];
  if (
    typeof cleanReq.instructions === 'string' &&
    cleanReq.instructions.length > 0
  ) {
    systemParts.push({ type: 'text', text: cleanReq.instructions });
  }

  const out: AnthropicMessagesRequest = {
    model: cleanReq.model,
    max_tokens: cleanReq.max_output_tokens ?? 1024,
    messages,
  } as AnthropicMessagesRequest;

  if (systemParts.length > 0) {
    out.system = systemParts;
  }
  if (typeof cleanReq.temperature === 'number') {
    out.temperature = cleanReq.temperature;
  }
  if (typeof cleanReq.top_p === 'number') {
    out.top_p = cleanReq.top_p;
  }
  // ResponseCreateParams has no `stop` field today (the Responses API
  // doesn't expose stop sequences directly); Anthropic's
  // `stop_sequences` is left unset on this conversion path.
  if (cleanReq.stream) {
    (out as AnthropicMessagesRequest & { stream?: boolean }).stream = true;
  }

  const tools = mapTools(cleanReq.tools ?? null);
  if (tools && tools.length > 0) {
    out.tools = tools as never;
    if (cleanReq.tool_choice) {
      const tc = mapToolChoice(cleanReq.tool_choice);
      if (tc) out.tool_choice = tc;
    }
  }

  // `reasoning.effort` mapping → Anthropic thinking config.
  // The Responses API uses `effort: 'low'|'medium'|'high'`; Anthropic's
  // thinking config takes a `budget_tokens` integer. Apply a coarse
  // budget tier — callers needing fine-grained control should use the
  // Anthropic Messages endpoint directly with `thinking.budget_tokens`.
  if (cleanReq.reasoning?.effort) {
    const budget = effortToBudget(cleanReq.reasoning.effort);
    if (budget != null) {
      (
        out as AnthropicMessagesRequest & {
          thinking?: { type: 'enabled'; budget_tokens: number };
        }
      ).thinking = { type: 'enabled', budget_tokens: budget };
    }
  }

  // T7: `text.format = json_schema` → synthetic Anthropic tool. Same
  // pattern the Chat→Anthropic adapter uses; the model is forced to
  // call the synthetic tool, and the response side unwraps the input
  // back into an OpenAI-shape JSON content string.
  const textFormat = cleanReq.text?.format as
    | {
        type?: string;
        name?: string;
        description?: string;
        schema?: Record<string, unknown>;
      }
    | undefined;
  if (
    textFormat?.type === 'json_schema' &&
    textFormat.schema &&
    typeof textFormat.schema === 'object'
  ) {
    applyStructuredOutputFromSchema(
      out,
      textFormat.schema,
      textFormat.name,
      textFormat.description
    );
  }

  // T7: re-apply Anthropic-only fields stowed by the cross-format
  // converter (cache_control, top_k, service_tier, metadata,
  // container, tool_choice override, system+tool cache breakpoints,
  // server tools).
  if (passthrough) {
    applyPassthrough(out, systemParts, passthrough);
  }

  return out;
}

function appendInputItem(
  messages: AnthropicMessageParam[],
  item: ResponseInputItem
): void {
  const type = (item as { type?: string }).type;

  if (type === 'message' || type === undefined) {
    const msg = item as Extract<
      ResponseInputItem,
      { type?: 'message'; role: 'user' | 'system' | 'developer' | 'assistant' }
    >;
    if (msg.role === 'system' || msg.role === 'developer') {
      // Only the first system goes into `req.system`; subsequent
      // system entries get folded onto the previous user message as
      // text — Anthropic disallows multiple system messages on the
      // wire, but we want callers to be able to mid-conversation
      // re-prompt without a 400.
      const text = stringifyContent(msg.content);
      if (text) {
        messages.push({ role: 'user', content: `[system] ${text}` });
      }
      return;
    }
    if (msg.role === 'user') {
      messages.push({
        role: 'user',
        content: mapInputContentToBlocks(msg.content),
      } as AnthropicMessageParam);
      return;
    }
    if (msg.role === 'assistant') {
      const blocks = mapInputContentToBlocks(msg.content);
      messages.push({
        role: 'assistant',
        content: blocks,
      } as AnthropicMessageParam);
    }
    return;
  }

  if (type === 'function_call') {
    const call = item as Extract<ResponseInputItem, { type: 'function_call' }>;
    let parsed: Record<string, unknown> = {};
    try {
      parsed = call.arguments ? JSON.parse(call.arguments) : {};
    } catch {
      parsed = {};
    }
    const block: AnthropicContentBlockParam = {
      type: 'tool_use',
      id: call.call_id,
      name: call.name,
      input: parsed,
    };
    const last = messages[messages.length - 1];
    if (last && last.role === 'assistant' && Array.isArray(last.content)) {
      (last.content as AnthropicContentBlockParam[]).push(block);
    } else {
      messages.push({ role: 'assistant', content: [block] });
    }
    return;
  }

  if (type === 'function_call_output') {
    const out = item as Extract<
      ResponseInputItem,
      { type: 'function_call_output' }
    >;
    const text =
      typeof out.output === 'string'
        ? out.output
        : Array.isArray(out.output)
        ? flattenFunctionCallOutputContent(
            out.output as Array<{ type?: string; text?: string }>
          )
        : '';
    const block: AnthropicContentBlockParam = {
      type: 'tool_result',
      tool_use_id: out.call_id,
      content: text,
    };
    const last = messages[messages.length - 1];
    if (last && last.role === 'user' && Array.isArray(last.content)) {
      (last.content as AnthropicContentBlockParam[]).push(block);
    } else {
      messages.push({ role: 'user', content: [block] });
    }
    return;
  }

  if (type === 'reasoning') {
    // Pinning a reasoning summary onto the previous assistant message
    // as a `thinking` block lets multi-turn agent loops continue with
    // signed reasoning preserved. The signature round-trips via the
    // Responses item's `encrypted_content` (sentinel prefix marks
    // `redacted_thinking` blocks), so Anthropic's signed-thinking
    // validator accepts the next request.
    const r = item as Extract<ResponseInputItem, { type: 'reasoning' }> & {
      encrypted_content?: string;
    };
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant' || !Array.isArray(last.content)) {
      return;
    }
    if (
      typeof r.encrypted_content === 'string' &&
      r.encrypted_content.startsWith('__vmx_redacted__:')
    ) {
      (last.content as AnthropicContentBlockParam[]).unshift({
        type: 'redacted_thinking',
        data: r.encrypted_content.slice('__vmx_redacted__:'.length),
      } as AnthropicContentBlockParam);
      return;
    }
    const text = (r.summary ?? [])
      .map((s) => (s as { text?: string }).text ?? '')
      .filter(Boolean)
      .join('\n');
    if (!text && !r.encrypted_content) return;
    (last.content as AnthropicContentBlockParam[]).unshift({
      type: 'thinking',
      thinking: text,
      signature: r.encrypted_content ?? '',
    });
    return;
  }
  // Unknown item types fall through silently — the SDK will emit a
  // 400 if the resulting body is invalid, which surfaces the gap.
}

function mapInputContentToBlocks(
  content: string | ResponseInputContent[] | unknown
): string | AnthropicContentBlockParam[] {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  const blocks: AnthropicContentBlockParam[] = [];
  for (const part of content as ResponseInputContent[]) {
    const t = (part as { type?: string }).type;
    if (t === 'input_text' || t === 'output_text') {
      blocks.push({ type: 'text', text: (part as { text: string }).text });
    } else if (t === 'input_image') {
      const img = part as { image_url?: string };
      if (img.image_url) {
        // Data URLs go to base64 source; HTTPS URLs to url source.
        if (img.image_url.startsWith('data:')) {
          const match = img.image_url.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            blocks.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: match[1] as 'image/jpeg',
                data: match[2],
              },
            } as AnthropicContentBlockParam);
          }
        } else {
          blocks.push({
            type: 'image',
            source: { type: 'url', url: img.image_url },
          } as AnthropicContentBlockParam);
        }
      }
    }
  }
  return blocks;
}

function stringifyContent(
  content: string | ResponseInputContent[] | unknown
): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return (content as ResponseInputContent[])
    .map((p) => {
      const t = (p as { type?: string }).type;
      if (t === 'input_text' || t === 'output_text') {
        return (p as { text?: string }).text ?? '';
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function flattenFunctionCallOutputContent(
  parts: Array<{ type?: string; text?: string }>
): string {
  return parts
    .filter((p) => p.type === 'input_text' || p.type === 'output_text')
    .map((p) => p.text ?? '')
    .join('');
}

function mapTools(tools: ResponsesTool[] | null): AnthropicTool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  const out: AnthropicTool[] = [];
  for (const tool of tools) {
    if (tool.type === 'function') {
      const fn = tool as Extract<ResponsesTool, { type: 'function' }>;
      out.push({
        name: fn.name,
        description: fn.description ?? undefined,
        input_schema: (fn.parameters ?? {}) as Record<string, unknown>,
      } as unknown as AnthropicTool);
    }
    // Hosted tools (web_search, file_search, code_interpreter, MCP,
    // computer use, image_gen, shell, apply_patch) have no Anthropic
    // equivalent in the standard schema — drop them to let the SDK
    // 400 if the model needs them. Server-tool passthrough for the
    // small subset Anthropic supports natively (web_search,
    // code_execution) is a future extension.
  }
  return out;
}

function mapToolChoice(
  choice: ResponseCreateParams['tool_choice']
): AnthropicMessagesRequest['tool_choice'] | undefined {
  if (!choice) return undefined;
  if (choice === 'auto') return { type: 'auto' };
  if (choice === 'none') return undefined;
  if (choice === 'required') return { type: 'any' };
  if (
    typeof choice === 'object' &&
    (choice as { type?: string }).type === 'function'
  ) {
    const c = choice as { type: 'function'; name: string };
    return { type: 'tool', name: c.name };
  }
  return undefined;
}

function effortToBudget(
  effort: 'minimal' | 'low' | 'medium' | 'high' | string | null | undefined
): number | null {
  switch (effort) {
    case 'minimal':
    case 'low':
      return 1024;
    case 'medium':
      return 4096;
    case 'high':
      return 16384;
    default:
      return null;
  }
}

// ─── Response side (non-streaming) ─────────────────────────────────

export function responseAnthropicToResponses(
  message: AnthropicMessage,
  responseId: string,
  createdAt: number,
  model: string,
  originalReq?: ResponseCreateParams
): OpenAIResponse {
  const output: ResponseOutputItem[] = [];
  let outputIndex = 0;

  for (const block of message.content) {
    if (block.type === 'thinking') {
      output.push({
        type: 'reasoning',
        id: `rs_${message.id}_${outputIndex++}`,
        summary: [{ type: 'summary_text', text: block.thinking ?? '' }],
        // Preserve the Anthropic signature on the way out so a Responses
        // client that round-trips this item back through the gateway
        // re-emits a signed thinking block (T2).
        ...(block.signature ? { encrypted_content: block.signature } : {}),
      } as unknown as ResponseOutputItem);
    } else if (block.type === 'redacted_thinking') {
      output.push({
        type: 'reasoning',
        id: `rs_${message.id}_${outputIndex++}`,
        summary: [],
        encrypted_content: `__vmx_redacted__:${block.data}`,
      } as unknown as ResponseOutputItem);
    } else if (block.type === 'text') {
      output.push({
        type: 'message',
        id: `msg_${message.id}_${outputIndex++}`,
        status: 'completed',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: block.text,
            annotations: [],
            logprobs: [],
          },
        ],
      } as unknown as ResponseOutputItem);
    } else if (block.type === 'tool_use') {
      output.push({
        type: 'function_call',
        id: `fc_${block.id}`,
        call_id: block.id,
        name: block.name,
        arguments: JSON.stringify(block.input ?? {}),
        status: 'completed',
      } as unknown as ResponseOutputItem);
    }
    // Server-tool blocks (server_tool_use, web_search_tool_result,
    // code_execution_tool_result, container_upload) lack Responses-API
    // equivalents in the simple-passthrough form. Drop silently — they
    // surface on the audit row's `responseData` (native Message body)
    // for any debugging that needs them.
  }

  const status: OpenAIResponse['status'] = mapStopReasonToStatus(
    message.stop_reason
  );

  const usage = message.usage ? buildResponsesUsage(message.usage) : undefined;

  return {
    id: responseId,
    object: 'response',
    created_at: createdAt,
    status,
    error: null,
    incomplete_details: null,
    instructions: originalReq?.instructions ?? null,
    max_output_tokens: originalReq?.max_output_tokens ?? null,
    model,
    output,
    parallel_tool_calls: originalReq?.parallel_tool_calls ?? true,
    previous_response_id: originalReq?.previous_response_id ?? null,
    reasoning: originalReq?.reasoning ?? null,
    store: originalReq?.store ?? false,
    temperature: originalReq?.temperature ?? null,
    text: originalReq?.text ?? { format: { type: 'text' } },
    tool_choice: originalReq?.tool_choice ?? 'auto',
    tools: originalReq?.tools ?? [],
    top_p: originalReq?.top_p ?? null,
    truncation: originalReq?.truncation ?? 'disabled',
    usage,
    user: null,
    metadata: originalReq?.metadata ?? null,
  } as unknown as OpenAIResponse;
}

function buildResponsesUsage(
  usage: AnthropicMessage['usage']
): OpenAIResponse['usage'] {
  const cacheCreation = (
    usage as { cache_creation?: Record<string, number> | null }
  ).cache_creation;
  return {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    total_tokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
    input_tokens_details: {
      cached_tokens: usage.cache_read_input_tokens ?? 0,
      ...(usage.cache_creation_input_tokens != null
        ? { cache_creation_input_tokens: usage.cache_creation_input_tokens }
        : {}),
      ...(cacheCreation ? { cache_creation: cacheCreation } : {}),
    },
    output_tokens_details: {
      reasoning_tokens: 0,
    },
  } as OpenAIResponse['usage'];
}

function mapStopReasonToStatus(
  reason: AnthropicMessage['stop_reason']
): OpenAIResponse['status'] {
  switch (reason) {
    case 'end_turn':
    case 'tool_use':
    case 'stop_sequence':
      return 'completed';
    case 'max_tokens':
      return 'incomplete';
    case 'pause_turn':
      return 'incomplete';
    case 'refusal':
      return 'completed';
    default:
      return 'completed';
  }
}

// ─── Stream side ───────────────────────────────────────────────────

export async function* streamAnthropicToResponses(
  source: AsyncIterable<RawMessageStreamEvent>,
  responseId: string,
  createdAt: number,
  model: string,
  originalReq?: ResponseCreateParams
): AsyncIterable<ResponseStreamEvent> {
  let sequence = 0;
  let messageId = '';
  let outputIndex = 0;
  // Per content_block index → kind + accumulated state.
  const blockState = new Map<
    number,
    {
      kind: 'text' | 'tool_use' | 'thinking' | 'other';
      itemId: string;
      callId?: string;
      name?: string;
      argumentsAccum?: string;
      textAccum?: string;
      thinkingAccum?: string;
      // Anthropic emits the signature via `signature_delta` events
      // (typically a single delta right before `content_block_stop`).
      // We accumulate here so the final reasoning item carries the
      // signed reasoning blob in `encrypted_content` for multi-turn
      // continuity (T2).
      signatureAccum?: string;
      outputIndex: number;
    }
  >();
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadInput = 0;
  let cacheCreationInput = 0;
  let stopReason: AnthropicMessage['stop_reason'] | null = null;
  // T14: accumulate the items emitted via per-block `output_item.done`
  // so the final `response.completed` event ships a populated
  // `output[]` array — strict consumers reading the final aggregate
  // event would otherwise see `output: []` despite valid items being
  // streamed.
  const accumulatedItems: ResponseOutputItem[] = [];

  const initialResponse = makeStreamingShellResponse(
    responseId,
    createdAt,
    model,
    originalReq
  );

  yield {
    type: 'response.created',
    response: initialResponse,
    sequence_number: sequence++,
  } as unknown as ResponseStreamEvent;
  yield {
    type: 'response.in_progress',
    response: initialResponse,
    sequence_number: sequence++,
  } as unknown as ResponseStreamEvent;

  for await (const event of source) {
    switch (event.type) {
      case 'message_start': {
        messageId = event.message.id;
        const u = event.message.usage as AnthropicMessage['usage'] | undefined;
        if (u) {
          inputTokens = u.input_tokens ?? 0;
          outputTokens = u.output_tokens ?? 0;
          cacheReadInput = u.cache_read_input_tokens ?? 0;
          cacheCreationInput = u.cache_creation_input_tokens ?? 0;
        }
        break;
      }
      case 'content_block_start': {
        const idx = event.index;
        const block = event.content_block;
        if (block.type === 'text') {
          const itemId = `msg_${messageId}_${outputIndex}`;
          blockState.set(idx, {
            kind: 'text',
            itemId,
            outputIndex,
            textAccum: '',
          });
          yield {
            type: 'response.output_item.added',
            output_index: outputIndex,
            item: {
              type: 'message',
              id: itemId,
              status: 'in_progress',
              role: 'assistant',
              content: [],
            },
            sequence_number: sequence++,
          } as unknown as ResponseStreamEvent;
          yield {
            type: 'response.content_part.added',
            item_id: itemId,
            output_index: outputIndex,
            content_index: 0,
            part: {
              type: 'output_text',
              text: '',
              annotations: [],
              logprobs: [],
            },
            sequence_number: sequence++,
          } as unknown as ResponseStreamEvent;
          outputIndex++;
        } else if (block.type === 'tool_use') {
          const itemId = `fc_${block.id}`;
          blockState.set(idx, {
            kind: 'tool_use',
            itemId,
            callId: block.id,
            name: block.name,
            argumentsAccum: '',
            outputIndex,
          });
          yield {
            type: 'response.output_item.added',
            output_index: outputIndex,
            item: {
              type: 'function_call',
              id: itemId,
              call_id: block.id,
              name: block.name,
              arguments: '',
              status: 'in_progress',
            },
            sequence_number: sequence++,
          } as unknown as ResponseStreamEvent;
          outputIndex++;
        } else if (block.type === 'thinking') {
          const itemId = `rs_${messageId}_${outputIndex}`;
          blockState.set(idx, {
            kind: 'thinking',
            itemId,
            outputIndex,
            thinkingAccum: '',
          });
          yield {
            type: 'response.output_item.added',
            output_index: outputIndex,
            item: {
              type: 'reasoning',
              id: itemId,
              summary: [],
            },
            sequence_number: sequence++,
          } as unknown as ResponseStreamEvent;
          outputIndex++;
        } else {
          // Server-tool / unknown blocks — track to drop the matching
          // content_block_stop without yielding spurious Response events.
          blockState.set(idx, {
            kind: 'other',
            itemId: '',
            outputIndex: -1,
          });
        }
        break;
      }
      case 'content_block_delta': {
        const idx = event.index;
        const state = blockState.get(idx);
        if (!state) break;
        const delta = event.delta as unknown as { type?: string } & Record<
          string,
          unknown
        >;
        if (state.kind === 'text' && delta.type === 'text_delta') {
          const text = (delta as { text?: string }).text ?? '';
          state.textAccum = (state.textAccum ?? '') + text;
          yield {
            type: 'response.output_text.delta',
            item_id: state.itemId,
            output_index: state.outputIndex,
            content_index: 0,
            delta: text,
            sequence_number: sequence++,
          } as unknown as ResponseStreamEvent;
        } else if (
          state.kind === 'tool_use' &&
          delta.type === 'input_json_delta'
        ) {
          const partial =
            (delta as { partial_json?: string }).partial_json ?? '';
          state.argumentsAccum = (state.argumentsAccum ?? '') + partial;
          yield {
            type: 'response.function_call_arguments.delta',
            item_id: state.itemId,
            output_index: state.outputIndex,
            delta: partial,
            sequence_number: sequence++,
          } as unknown as ResponseStreamEvent;
        } else if (
          state.kind === 'thinking' &&
          delta.type === 'thinking_delta'
        ) {
          const text = (delta as { thinking?: string }).thinking ?? '';
          state.thinkingAccum = (state.thinkingAccum ?? '') + text;
          yield {
            type: 'response.reasoning_summary_text.delta',
            item_id: state.itemId,
            output_index: state.outputIndex,
            summary_index: 0,
            delta: text,
            sequence_number: sequence++,
          } as unknown as ResponseStreamEvent;
        } else if (
          state.kind === 'thinking' &&
          delta.type === 'signature_delta'
        ) {
          // Accumulate the signature; emit it on the final reasoning
          // item below so the Responses-shape `encrypted_content` field
          // carries it for multi-turn signed-thinking continuity.
          const sig = (delta as { signature?: string }).signature ?? '';
          state.signatureAccum = (state.signatureAccum ?? '') + sig;
        }
        break;
      }
      case 'content_block_stop': {
        const idx = event.index;
        const state = blockState.get(idx);
        if (!state) break;
        if (state.kind === 'text') {
          yield {
            type: 'response.output_text.done',
            item_id: state.itemId,
            output_index: state.outputIndex,
            content_index: 0,
            text: state.textAccum ?? '',
            sequence_number: sequence++,
          } as unknown as ResponseStreamEvent;
          yield {
            type: 'response.content_part.done',
            item_id: state.itemId,
            output_index: state.outputIndex,
            content_index: 0,
            part: {
              type: 'output_text',
              text: state.textAccum ?? '',
              annotations: [],
              logprobs: [],
            },
            sequence_number: sequence++,
          } as unknown as ResponseStreamEvent;
          const messageItem = {
            type: 'message',
            id: state.itemId,
            status: 'completed',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: state.textAccum ?? '',
                annotations: [],
                logprobs: [],
              },
            ],
          } as unknown as ResponseOutputItem;
          accumulatedItems.push(messageItem);
          yield {
            type: 'response.output_item.done',
            output_index: state.outputIndex,
            item: messageItem,
            sequence_number: sequence++,
          } as unknown as ResponseStreamEvent;
        } else if (state.kind === 'tool_use') {
          yield {
            type: 'response.function_call_arguments.done',
            item_id: state.itemId,
            output_index: state.outputIndex,
            arguments: state.argumentsAccum ?? '',
            sequence_number: sequence++,
          } as unknown as ResponseStreamEvent;
          const functionCallItem = {
            type: 'function_call',
            id: state.itemId,
            call_id: state.callId ?? '',
            name: state.name ?? '',
            arguments: state.argumentsAccum ?? '',
            status: 'completed',
          } as unknown as ResponseOutputItem;
          accumulatedItems.push(functionCallItem);
          yield {
            type: 'response.output_item.done',
            output_index: state.outputIndex,
            item: functionCallItem,
            sequence_number: sequence++,
          } as unknown as ResponseStreamEvent;
        } else if (state.kind === 'thinking') {
          yield {
            type: 'response.reasoning_summary_text.done',
            item_id: state.itemId,
            output_index: state.outputIndex,
            summary_index: 0,
            text: state.thinkingAccum ?? '',
            sequence_number: sequence++,
          } as unknown as ResponseStreamEvent;
          const reasoningItem = {
            type: 'reasoning',
            id: state.itemId,
            summary: [
              { type: 'summary_text', text: state.thinkingAccum ?? '' },
            ],
            // Surface the accumulated Anthropic signature on the
            // Responses item so a downstream caller can round-trip
            // it back through the gateway with multi-turn signed-
            // thinking continuity intact (T2).
            ...(state.signatureAccum
              ? { encrypted_content: state.signatureAccum }
              : {}),
          } as unknown as ResponseOutputItem;
          accumulatedItems.push(reasoningItem);
          yield {
            type: 'response.output_item.done',
            output_index: state.outputIndex,
            item: reasoningItem,
            sequence_number: sequence++,
          } as unknown as ResponseStreamEvent;
        }
        blockState.delete(idx);
        break;
      }
      case 'message_delta': {
        const u = event.usage as AnthropicMessage['usage'] | undefined;
        if (u) {
          // Anthropic emits cumulative-last-wins on message_delta.
          if (typeof u.output_tokens === 'number') {
            outputTokens = u.output_tokens;
          }
          if (typeof u.input_tokens === 'number') {
            inputTokens = u.input_tokens;
          }
        }
        if (event.delta.stop_reason) {
          stopReason = event.delta.stop_reason;
        }
        break;
      }
      case 'message_stop': {
        const finalResponse = makeFinalResponse({
          responseId,
          createdAt,
          model,
          outputItems: accumulatedItems,
          stopReason,
          usage: {
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            cache_read_input_tokens: cacheReadInput,
            cache_creation_input_tokens: cacheCreationInput,
          },
          originalReq,
        });
        yield {
          type: 'response.completed',
          response: finalResponse,
          sequence_number: sequence++,
        } as unknown as ResponseStreamEvent;
        break;
      }
      // Server-tool start / stop / delta and citation events fall
      // through silently — no Responses-API equivalent.
      default:
        break;
    }
  }
}

function makeStreamingShellResponse(
  responseId: string,
  createdAt: number,
  model: string,
  originalReq?: ResponseCreateParams
): OpenAIResponse {
  return {
    id: responseId,
    object: 'response',
    created_at: createdAt,
    status: 'in_progress',
    error: null,
    incomplete_details: null,
    instructions: originalReq?.instructions ?? null,
    max_output_tokens: originalReq?.max_output_tokens ?? null,
    model,
    output: [],
    parallel_tool_calls: originalReq?.parallel_tool_calls ?? true,
    previous_response_id: originalReq?.previous_response_id ?? null,
    reasoning: originalReq?.reasoning ?? null,
    store: originalReq?.store ?? false,
    temperature: originalReq?.temperature ?? null,
    text: originalReq?.text ?? { format: { type: 'text' } },
    tool_choice: originalReq?.tool_choice ?? 'auto',
    tools: originalReq?.tools ?? [],
    top_p: originalReq?.top_p ?? null,
    truncation: originalReq?.truncation ?? 'disabled',
    usage: undefined,
    user: null,
    metadata: originalReq?.metadata ?? null,
  } as unknown as OpenAIResponse;
}

function makeFinalResponse(args: {
  responseId: string;
  createdAt: number;
  model: string;
  outputItems: ResponseOutputItem[];
  stopReason: AnthropicMessage['stop_reason'] | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  };
  originalReq?: ResponseCreateParams;
}): OpenAIResponse {
  return {
    id: args.responseId,
    object: 'response',
    created_at: args.createdAt,
    status: mapStopReasonToStatus(args.stopReason),
    error: null,
    incomplete_details: null,
    instructions: args.originalReq?.instructions ?? null,
    max_output_tokens: args.originalReq?.max_output_tokens ?? null,
    model: args.model,
    output: args.outputItems,
    parallel_tool_calls: args.originalReq?.parallel_tool_calls ?? true,
    previous_response_id: args.originalReq?.previous_response_id ?? null,
    reasoning: args.originalReq?.reasoning ?? null,
    store: args.originalReq?.store ?? false,
    temperature: args.originalReq?.temperature ?? null,
    text: args.originalReq?.text ?? { format: { type: 'text' } },
    tool_choice: args.originalReq?.tool_choice ?? 'auto',
    tools: args.originalReq?.tools ?? [],
    top_p: args.originalReq?.top_p ?? null,
    truncation: args.originalReq?.truncation ?? 'disabled',
    usage: {
      input_tokens: args.usage.input_tokens,
      output_tokens: args.usage.output_tokens,
      total_tokens: args.usage.input_tokens + args.usage.output_tokens,
      input_tokens_details: {
        cached_tokens: args.usage.cache_read_input_tokens,
        ...(args.usage.cache_creation_input_tokens > 0
          ? {
              cache_creation_input_tokens:
                args.usage.cache_creation_input_tokens,
            }
          : {}),
      },
      output_tokens_details: { reasoning_tokens: 0 },
    } as OpenAIResponse['usage'],
    user: null,
    metadata: args.originalReq?.metadata ?? null,
  } as unknown as OpenAIResponse;
}

// Suppress unused import — kept for future cache_control work that
// re-attaches breakpoints to system blocks via TextBlockParam shape.
void (null as unknown as TextBlockParam);

// ─── Provider class ────────────────────────────────────────────────

@Injectable()
export class AnthropicOpenAIResponseProvider {
  constructor(private readonly dispatcher: AnthropicDispatcher) {}

  async handle(
    request: ResponseCreateParams,
    connection: AIConnectionEntity<AnthropicConnectionConfig>,
    model: AIResourceModelConfigEntity,
    options?: CompletionRequestOptions
  ): Promise<OpenAIResponseResponse> {
    const anthropicBody: AnthropicMessagesRequest = {
      ...requestResponsesToAnthropic(request),
      model: model.model,
    };
    const native = await this.dispatcher.dispatchNative(
      anthropicBody,
      connection,
      model,
      options
    );
    const responseId = `resp_${uuidv4()}`;
    const createdAt = Math.floor(Date.now() / 1000);

    if (
      native.data != null &&
      typeof (native.data as AsyncIterable<RawMessageStreamEvent>)[
        Symbol.asyncIterator
      ] === 'function'
    ) {
      return {
        data: streamAnthropicToResponses(
          native.data as AsyncIterable<RawMessageStreamEvent>,
          responseId,
          createdAt,
          model.model,
          request
        ),
        headers: native.headers,
        providerRequestPayload: native.providerRequestPayload,
      };
    }
    return {
      data: responseAnthropicToResponses(
        native.data as AnthropicMessage,
        responseId,
        createdAt,
        model.model,
        request
      ),
      headers: native.headers,
      providerRequestPayload: native.providerRequestPayload,
    };
  }
}
