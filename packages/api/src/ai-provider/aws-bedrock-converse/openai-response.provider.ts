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
import {
  ContentBlock,
  ConverseCommandInput,
  ConverseCommandOutput,
  ConverseStreamOutput,
  Message as ConverseMessage,
  StopReason,
  Tool as ConverseTool,
  ToolChoice as ConverseToolChoice,
} from '@aws-sdk/client-bedrock-runtime';
import { v4 as uuidv4 } from 'uuid';
import { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import {
  CompletionRequestOptions,
  OpenAIResponseResponse,
} from '../ai-provider.types';
import {
  AWSBedrockAIConnectionConfig,
  AWSBedrockConverseDispatcher,
} from './shared';
import { assertModelSupportsFeatures } from './capability-gate';

/**
 * Bedrock Converse handler for OpenAI Responses input — direct
 * Responses ↔ Converse converter. No internal pivot through
 * ChatCompletion.
 *
 * Mapping summary:
 *
 *   Request  Responses → Converse
 *     instructions → system: [{text: ...}]
 *     input (string) → user message with text block
 *     input (items)
 *       message       → role-based message with text/image blocks
 *       function_call → assistant message with toolUse block
 *       function_call_output → user message with toolResult block
 *       reasoning     → assistant reasoningContent block (signed)
 *     tools (function) → toolConfig.tools[].toolSpec
 *     tool_choice   → toolConfig.toolChoice
 *     temperature, top_p, max_output_tokens, stop → inferenceConfig
 *     reasoning.effort → additionalModelRequestFields.thinking (budget tier)
 *
 *   Response  Converse → Response
 *     output.message.content
 *       text          → output_text part inside message item
 *       toolUse       → function_call output item
 *       reasoningContent → reasoning output item with summary text
 *     stopReason      → status (end_turn → completed, max_tokens →
 *                       incomplete, tool_use → completed)
 *     usage           → input_tokens + output_tokens + details
 *
 *   Stream  Converse → Response stream
 *     messageStart → response.created + response.in_progress
 *     contentBlockStart (toolUse) → output_item.added (function_call)
 *     contentBlockDelta (text)    → output_item.added(message) +
 *                                   content_part.added + output_text.delta
 *     contentBlockDelta (toolUse) → function_call_arguments.delta
 *     contentBlockDelta (reasoningContent) → reasoning_summary_text.delta
 *     contentBlockStop → output_text.done + content_part.done +
 *                        output_item.done (or function_call_arguments.done)
 *     messageStop      → buffer stop reason
 *     metadata.usage   → buffer usage
 *     final            → response.completed
 */

// ─── Stop reason mapping ───────────────────────────────────────────

function mapConverseStopToResponseStatus(
  reason: StopReason | undefined
): OpenAIResponse['status'] {
  switch (reason) {
    case StopReason.MAX_TOKENS:
    case StopReason.MODEL_CONTEXT_WINDOW_EXCEEDED:
      return 'incomplete';
    case StopReason.CONTENT_FILTERED:
    case StopReason.GUARDRAIL_INTERVENED:
      return 'incomplete';
    case StopReason.END_TURN:
    case StopReason.STOP_SEQUENCE:
    case StopReason.TOOL_USE:
    case StopReason.MALFORMED_TOOL_USE:
    case StopReason.MALFORMED_MODEL_OUTPUT:
    default:
      return 'completed';
  }
}

// ─── Request side ──────────────────────────────────────────────────

export function requestResponsesToConverse(
  req: ResponseCreateParams,
  modelId: string
): ConverseCommandInput {
  const messages: ConverseMessage[] = [];

  const inputItems: ResponseInputItem[] = Array.isArray(req.input)
    ? req.input
    : [
        {
          type: 'message',
          role: 'user',
          content: req.input ?? '',
        } as ResponseInputItem,
      ];

  for (const item of inputItems) {
    appendInputItemToConverse(messages, item);
  }

  const system: ConverseCommandInput['system'] = [];
  if (typeof req.instructions === 'string' && req.instructions.length > 0) {
    system.push({ text: req.instructions });
  }

  // T11: `tool_choice: 'none'` has no Converse equivalent — map to
  // "no tools sent" so the model literally can't call any tool.
  const toolChoiceIsNone = req.tool_choice === 'none';
  const tools = toolChoiceIsNone
    ? undefined
    : mapResponsesToolsToConverse(req.tools ?? null);
  const toolChoice = toolChoiceIsNone
    ? undefined
    : mapResponsesToolChoiceToConverse(req.tool_choice);

  const additionalModelRequestFields: Record<string, unknown> = {};
  if (req.reasoning?.effort) {
    const budget = effortToBudget(req.reasoning.effort);
    if (budget != null) {
      additionalModelRequestFields.thinking = {
        type: 'enabled',
        budget_tokens: budget,
      };
    }
  }

  return {
    modelId,
    messages,
    // ResponseCreateParams doesn't expose `stop` sequences directly,
    // so `stopSequences` is left unset on this conversion path.
    inferenceConfig: {
      temperature:
        typeof req.temperature === 'number' ? req.temperature : undefined,
      topP: typeof req.top_p === 'number' ? req.top_p : undefined,
      maxTokens: req.max_output_tokens ?? undefined,
    },
    ...(system.length > 0 ? { system } : {}),
    ...(tools && tools.length > 0
      ? {
          toolConfig: {
            tools,
            ...(toolChoice ? { toolChoice } : {}),
          },
        }
      : {}),
    ...(Object.keys(additionalModelRequestFields).length > 0
      ? {
          additionalModelRequestFields:
            additionalModelRequestFields as unknown as ConverseCommandInput['additionalModelRequestFields'],
        }
      : {}),
  };
}

function appendInputItemToConverse(
  messages: ConverseMessage[],
  item: ResponseInputItem
): void {
  const type = (item as { type?: string }).type;

  if (type === 'message' || type === undefined) {
    const msg = item as Extract<
      ResponseInputItem,
      { type?: 'message'; role: 'user' | 'system' | 'developer' | 'assistant' }
    >;
    if (msg.role === 'system' || msg.role === 'developer') {
      // Inline a developer message as a user prompt prefix; only
      // `instructions` becomes the first system block (handled in
      // `requestResponsesToConverse`).
      const text = stringifyResponsesContent(msg.content);
      if (text) {
        messages.push({
          role: 'user',
          content: [{ text: `[system] ${text}` }],
        });
      }
      return;
    }
    if (msg.role === 'user') {
      const content = mapResponsesInputContentToConverse(msg.content);
      if (content.length > 0) messages.push({ role: 'user', content });
      return;
    }
    if (msg.role === 'assistant') {
      const content = mapResponsesInputContentToConverse(msg.content);
      if (content.length > 0) messages.push({ role: 'assistant', content });
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
    const block: ContentBlock = {
      toolUse: {
        toolUseId: call.call_id,
        name: call.name,
        // SDK types `input` as `DocumentType` — cast through unknown to
        // widen from the parsed `Record<string, unknown>`.
        input: parsed as unknown as never,
      },
    };
    const last = messages[messages.length - 1];
    if (last && last.role === 'assistant' && Array.isArray(last.content)) {
      last.content.push(block);
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
        ? (out.output as Array<{ type?: string; text?: string }>)
            .filter((p) => p.type === 'input_text' || p.type === 'output_text')
            .map((p) => p.text ?? '')
            .join('')
        : '';
    const block: ContentBlock = {
      toolResult: {
        toolUseId: out.call_id,
        content: [{ text }],
        status: 'success',
      },
    };
    const last = messages[messages.length - 1];
    if (last && last.role === 'user' && Array.isArray(last.content)) {
      last.content.push(block);
    } else {
      messages.push({ role: 'user', content: [block] });
    }
    return;
  }

  if (type === 'reasoning') {
    // Stash reasoning summary as a `reasoningContent` block on the
    // previous assistant message — preserves multi-turn signed
    // reasoning continuity. The signature round-trips via the
    // Responses item's `encrypted_content` (T2); without it, Bedrock
    // rejects re-injected thinking on Claude as malformed.
    const r = item as Extract<ResponseInputItem, { type: 'reasoning' }> & {
      encrypted_content?: string;
    };
    const text = (r.summary ?? [])
      .map((s) => (s as { text?: string }).text ?? '')
      .filter(Boolean)
      .join('\n');
    if (!text && !r.encrypted_content) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant' || !Array.isArray(last.content)) {
      return;
    }
    // Sentinel-prefixed encrypted_content signals a redacted_thinking
    // round-trip. Bedrock Converse exposes redacted reasoning via
    // `reasoningContent.redactedContent`.
    if (
      typeof r.encrypted_content === 'string' &&
      r.encrypted_content.startsWith('__vmx_redacted__:')
    ) {
      last.content.unshift({
        reasoningContent: {
          redactedContent: Buffer.from(
            r.encrypted_content.slice('__vmx_redacted__:'.length),
            'base64'
          ),
        },
      } as ContentBlock);
      return;
    }
    last.content.unshift({
      reasoningContent: {
        reasoningText: {
          text,
          ...(r.encrypted_content ? { signature: r.encrypted_content } : {}),
        },
      },
    });
    return;
  }
  // Unknown item types fall through silently.
}

function mapResponsesInputContentToConverse(
  content: string | ResponseInputContent[] | unknown
): ContentBlock[] {
  if (typeof content === 'string') return [{ text: content }];
  if (!Array.isArray(content)) return [];
  const blocks: ContentBlock[] = [];
  for (const part of content as ResponseInputContent[]) {
    const t = (part as { type?: string }).type;
    if (t === 'input_text' || t === 'output_text') {
      blocks.push({ text: (part as { text: string }).text });
    } else if (t === 'input_image') {
      const img = part as { image_url?: string };
      if (img.image_url && img.image_url.startsWith('data:')) {
        const match = img.image_url.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          const fmt = match[1].split('/').pop()?.toLowerCase();
          blocks.push({
            image: {
              format: (fmt ?? 'jpeg') as never,
              source: { bytes: Buffer.from(match[2], 'base64') },
            },
          });
        }
      }
      // URL-source images dropped silently — Converse's ImageBlock
      // requires `bytes`.
    }
  }
  return blocks;
}

function stringifyResponsesContent(
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

function mapResponsesToolsToConverse(
  tools: ResponsesTool[] | null
): ConverseTool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  const out: ConverseTool[] = [];
  for (const tool of tools) {
    if (tool.type === 'function') {
      const fn = tool as Extract<ResponsesTool, { type: 'function' }>;
      out.push({
        toolSpec: {
          name: fn.name,
          description: fn.description ?? undefined,
          inputSchema: {
            json: (fn.parameters ?? {}) as never,
          },
        },
      });
    }
    // Hosted tools (web_search, file_search, computer_use, mcp,
    // image_gen, code_interpreter, shell, apply_patch) have no
    // direct Converse equivalent — drop silently.
  }
  return out.length > 0 ? out : undefined;
}

function mapResponsesToolChoiceToConverse(
  choice: ResponseCreateParams['tool_choice']
): ConverseToolChoice | undefined {
  if (!choice) return undefined;
  if (choice === 'auto') return { auto: {} };
  if (choice === 'required') return { any: {} };
  if (choice === 'none') return undefined;
  if (
    typeof choice === 'object' &&
    (choice as { type?: string }).type === 'function'
  ) {
    const c = choice as { type: 'function'; name: string };
    return { tool: { name: c.name } };
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

export function responseConverseToResponses(
  resp: ConverseCommandOutput,
  responseId: string,
  createdAt: number,
  model: string,
  originalReq?: ResponseCreateParams
): OpenAIResponse {
  const output: ResponseOutputItem[] = [];
  let outputIndex = 0;
  const baseId = resp.$metadata.requestId ?? uuidv4();

  for (const block of resp.output?.message?.content ?? []) {
    if (block.text) {
      output.push({
        type: 'message',
        id: `msg_${baseId}_${outputIndex++}`,
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
    } else if (block.toolUse) {
      output.push({
        type: 'function_call',
        id: `fc_${block.toolUse.toolUseId}`,
        call_id: block.toolUse.toolUseId,
        name: block.toolUse.name ?? '',
        arguments:
          typeof block.toolUse.input === 'string'
            ? block.toolUse.input
            : JSON.stringify(block.toolUse.input ?? {}),
        status: 'completed',
      } as unknown as ResponseOutputItem);
    } else if (block.reasoningContent?.reasoningText) {
      const sig = block.reasoningContent.reasoningText.signature;
      output.push({
        type: 'reasoning',
        id: `rs_${baseId}_${outputIndex++}`,
        summary: [
          {
            type: 'summary_text',
            text: block.reasoningContent.reasoningText.text ?? '',
          },
        ],
        // Round-trip the signed-thinking blob via `encrypted_content`
        // so a Responses-shape consumer can re-emit it on the next
        // turn without breaking Bedrock's signature validator (T2).
        ...(sig ? { encrypted_content: sig } : {}),
      } as unknown as ResponseOutputItem);
    } else if (block.reasoningContent?.redactedContent) {
      // Redacted reasoning lacks a textual summary — preserve the
      // opaque blob so it round-trips back to Bedrock as
      // `reasoningContent.redactedContent` on a subsequent turn.
      const data = Buffer.isBuffer(block.reasoningContent.redactedContent)
        ? block.reasoningContent.redactedContent.toString('base64')
        : Buffer.from(
            block.reasoningContent.redactedContent as Uint8Array
          ).toString('base64');
      output.push({
        type: 'reasoning',
        id: `rs_${baseId}_${outputIndex++}`,
        summary: [],
        encrypted_content: `__vmx_redacted__:${data}`,
      } as unknown as ResponseOutputItem);
    }
  }

  const status = mapConverseStopToResponseStatus(resp.stopReason);

  const usage = resp.usage
    ? ({
        input_tokens: resp.usage.inputTokens ?? 0,
        output_tokens: resp.usage.outputTokens ?? 0,
        total_tokens: resp.usage.totalTokens ?? 0,
        input_tokens_details: {
          cached_tokens: resp.usage.cacheReadInputTokens ?? 0,
          ...(resp.usage.cacheWriteInputTokens != null
            ? {
                cache_creation_input_tokens: resp.usage.cacheWriteInputTokens,
              }
            : {}),
        },
        output_tokens_details: { reasoning_tokens: 0 },
      } as OpenAIResponse['usage'])
    : undefined;

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

// ─── Stream side ───────────────────────────────────────────────────

export async function* streamConverseToResponses(
  source: AsyncIterable<ConverseStreamOutput>,
  responseId: string,
  createdAt: number,
  model: string,
  originalReq?: ResponseCreateParams
): AsyncIterable<ResponseStreamEvent> {
  let sequence = 0;
  let outputIndex = 0;
  // Per Converse contentBlockIndex → { kind, itemId, openOutputIndex }.
  const blockState = new Map<
    number,
    {
      kind: 'text' | 'tool_use' | 'thinking';
      itemId: string;
      callId?: string;
      name?: string;
      argumentsAccum?: string;
      textAccum?: string;
      thinkingAccum?: string;
      // Bedrock streams the reasoning signature via a final
      // `delta.reasoningContent.signature` event right before
      // `contentBlockStop`. Accumulate so the closing reasoning item
      // can carry it as `encrypted_content` (T2).
      signatureAccum?: string;
      outputIndex: number;
    }
  >();
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadInput = 0;
  let cacheCreationInput = 0;
  let stopReason: StopReason | undefined;
  // T14: accumulate items emitted via per-block `output_item.done` so
  // the final `response.completed` event ships a populated `output[]`.
  const accumulatedItems: ResponseOutputItem[] = [];

  const initial = makeStreamingShellResponse(
    responseId,
    createdAt,
    model,
    originalReq
  );
  yield {
    type: 'response.created',
    response: initial,
    sequence_number: sequence++,
  } as unknown as ResponseStreamEvent;
  yield {
    type: 'response.in_progress',
    response: initial,
    sequence_number: sequence++,
  } as unknown as ResponseStreamEvent;

  for await (const item of source) {
    if (item.messageStart) continue;

    if (item.contentBlockStart?.start?.toolUse) {
      const idx = item.contentBlockStart.contentBlockIndex ?? 0;
      const tu = item.contentBlockStart.start.toolUse;
      const itemId = `fc_${tu.toolUseId}`;
      blockState.set(idx, {
        kind: 'tool_use',
        itemId,
        callId: tu.toolUseId,
        name: tu.name,
        argumentsAccum: '',
        outputIndex,
      });
      yield {
        type: 'response.output_item.added',
        output_index: outputIndex,
        item: {
          type: 'function_call',
          id: itemId,
          call_id: tu.toolUseId,
          name: tu.name,
          arguments: '',
          status: 'in_progress',
        },
        sequence_number: sequence++,
      } as unknown as ResponseStreamEvent;
      outputIndex++;
      continue;
    }

    if (item.contentBlockDelta) {
      const idx = item.contentBlockDelta.contentBlockIndex ?? 0;
      const delta = item.contentBlockDelta.delta;
      let state = blockState.get(idx);
      if (delta?.text != null) {
        if (!state) {
          // Synthesise a text block start on first delta.
          const itemId = `msg_${responseId}_${outputIndex}`;
          state = {
            kind: 'text',
            itemId,
            textAccum: '',
            outputIndex,
          };
          blockState.set(idx, state);
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
        }
        state.textAccum = (state.textAccum ?? '') + delta.text;
        yield {
          type: 'response.output_text.delta',
          item_id: state.itemId,
          output_index: state.outputIndex,
          content_index: 0,
          delta: delta.text,
          sequence_number: sequence++,
        } as unknown as ResponseStreamEvent;
      } else if (delta?.toolUse && state?.kind === 'tool_use') {
        const partial = delta.toolUse.input ?? '';
        state.argumentsAccum = (state.argumentsAccum ?? '') + partial;
        yield {
          type: 'response.function_call_arguments.delta',
          item_id: state.itemId,
          output_index: state.outputIndex,
          delta: partial,
          sequence_number: sequence++,
        } as unknown as ResponseStreamEvent;
      } else if (delta?.reasoningContent) {
        if (!state) {
          const itemId = `rs_${responseId}_${outputIndex}`;
          state = {
            kind: 'thinking',
            itemId,
            thinkingAccum: '',
            outputIndex,
          };
          blockState.set(idx, state);
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
        }
        if (delta.reasoningContent.text) {
          state.thinkingAccum =
            (state.thinkingAccum ?? '') + delta.reasoningContent.text;
          yield {
            type: 'response.reasoning_summary_text.delta',
            item_id: state.itemId,
            output_index: state.outputIndex,
            summary_index: 0,
            delta: delta.reasoningContent.text,
            sequence_number: sequence++,
          } as unknown as ResponseStreamEvent;
        }
        const sigDelta = (delta.reasoningContent as { signature?: string })
          .signature;
        if (sigDelta) {
          state.signatureAccum = (state.signatureAccum ?? '') + sigDelta;
        }
      }
      continue;
    }

    if (item.contentBlockStop) {
      const idx = item.contentBlockStop.contentBlockIndex ?? 0;
      const state = blockState.get(idx);
      if (!state) continue;
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
        const fcItem = {
          type: 'function_call',
          id: state.itemId,
          call_id: state.callId ?? '',
          name: state.name ?? '',
          arguments: state.argumentsAccum ?? '',
          status: 'completed',
        } as unknown as ResponseOutputItem;
        accumulatedItems.push(fcItem);
        yield {
          type: 'response.output_item.done',
          output_index: state.outputIndex,
          item: fcItem,
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
          summary: [{ type: 'summary_text', text: state.thinkingAccum ?? '' }],
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
      continue;
    }

    if (item.messageStop) {
      stopReason = item.messageStop.stopReason;
      continue;
    }

    if (item.metadata?.usage) {
      const u = item.metadata.usage;
      inputTokens = u.inputTokens ?? inputTokens;
      outputTokens = u.outputTokens ?? outputTokens;
      cacheReadInput = u.cacheReadInputTokens ?? cacheReadInput;
      cacheCreationInput = u.cacheWriteInputTokens ?? cacheCreationInput;
    }
  }

  const finalResponse = makeFinalResponse({
    responseId,
    createdAt,
    model,
    status: mapConverseStopToResponseStatus(stopReason),
    outputItems: accumulatedItems,
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
  status: OpenAIResponse['status'];
  /**
   * T14: items the stream emitted via per-block `output_item.done`,
   * accumulated and replayed on the final `response.completed`
   * payload so consumers reading the aggregate event see the real
   * output instead of an empty array.
   */
  outputItems?: ResponseOutputItem[];
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
    status: args.status,
    error: null,
    incomplete_details: null,
    instructions: args.originalReq?.instructions ?? null,
    max_output_tokens: args.originalReq?.max_output_tokens ?? null,
    model: args.model,
    output: args.outputItems ?? [],
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

// ─── Provider class ────────────────────────────────────────────────

@Injectable()
export class AWSBedrockConverseOpenAIResponseProvider {
  constructor(private readonly dispatcher: AWSBedrockConverseDispatcher) {}

  async handle(
    request: ResponseCreateParams,
    connection: AIConnectionEntity<AWSBedrockAIConnectionConfig>,
    model: AIResourceModelConfigEntity,
    options?: CompletionRequestOptions
  ): Promise<OpenAIResponseResponse> {
    // T19: pre-flight gate.
    if (request.tools?.length && request.tool_choice !== 'none') {
      assertModelSupportsFeatures(model.model, { tools: true });
    }
    const input = requestResponsesToConverse(request, model.model);
    // T22: thread the connection's `performanceConfig.latency` onto
    // the Converse command input — only the OpenAI Chat path was
    // doing this before, so Resp-input requests silently lost the
    // optimised-latency setting. The Anthropic-input path already
    // does it via the same field on `requestAnthropicToConverse`'s
    // caller; here we patch the input post-build because
    // `requestResponsesToConverse` is a pure function with no
    // connection access.
    if (connection.config?.performanceConfig) {
      input.performanceConfig = {
        latency: connection.config.performanceConfig.latency,
      };
    }
    // T21: same connection-level Bedrock Guardrails config that the
    // Chat-input path applies — propagate so Resp-shape requests
    // get the same protection.
    if (connection.config?.guardrailConfig) {
      input.guardrailConfig = {
        guardrailIdentifier:
          connection.config.guardrailConfig.guardrailIdentifier,
        guardrailVersion: connection.config.guardrailConfig.guardrailVersion,
        trace: connection.config.guardrailConfig.trace ?? 'enabled',
      };
    }
    const native = await this.dispatcher.dispatchConverseRaw(
      input,
      !!request.stream,
      connection,
      options
    );
    const responseId = `resp_${uuidv4()}`;
    const createdAt = Math.floor(Date.now() / 1000);

    if (
      native.data != null &&
      typeof (native.data as AsyncIterable<ConverseStreamOutput>)[
        Symbol.asyncIterator
      ] === 'function'
    ) {
      return {
        data: streamConverseToResponses(
          native.data as AsyncIterable<ConverseStreamOutput>,
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
      data: responseConverseToResponses(
        native.data as ConverseCommandOutput,
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
