import { Injectable } from '@nestjs/common';
import type {
  ContentBlockParam as AnthropicContentBlockParam,
  Message as AnthropicMessage,
  RawMessageDeltaEvent,
  RawMessageStartEvent,
  RawMessageStopEvent,
  RawMessageStreamEvent,
  TextBlock,
  TextDelta,
  ThinkingBlock,
  ToolResultBlockParam,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources/messages';
import {
  type Content,
  type FunctionDeclaration,
  type FunctionResponsePart,
  type GenerateContentConfig,
  type GenerateContentParameters,
  type GenerateContentResponse,
  type Part,
  type Tool,
  type ToolConfig,
} from '@google/genai';
import { v4 as uuidv4 } from 'uuid';
import { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import {
  AnthropicMessagesResponse,
  CompletionRequestOptions,
} from '../ai-provider.types';
import type {
  AnthropicMessagesRequest,
  AnthropicToolChoice,
  AnthropicToolUnion,
} from '../../gateway/anthropic/anthropic.types';
import {
  GeminiDispatcher,
  type GeminiConnectionConfig,
  type StreamAccumulator,
  applyGeminiProviderArgs,
  coerceJsonSchema,
  geminiResponseId,
  isGeminiNativeTool,
  makeFunctionCallingConfig,
  mapFinishReason,
  mapReasoningEffortToThinking,
  mapUsageMetadata,
  newStreamAccumulator,
  urlToFunctionResponsePart,
  urlToMediaPart,
} from './shared';
import {
  classifyAnthropicServerTool,
  isServerToolHistoryBlock,
  liftAnthropicServerToolBlockToText,
  raiseUnsupportedServerTool,
} from '../adapters/anthropic-server-tools';

/**
 * Gemini's Anthropic-Messages input handler — direct one-pair
 * Anthropic ↔ Gemini-native converter. No pivot through ChatCompletion;
 * the SDK call goes through `GeminiDispatcher`.
 *
 * Mapping highlights:
 *
 *   Request  Anthropic → Gemini
 *     system            → systemInstruction
 *     messages[].content (text/image/document) → Content.parts
 *     tool_use blocks   → functionCall part (role:'model')
 *     tool_result blocks → functionResponse part (role:'user')
 *     thinking blocks   → thought:true text part
 *     tools             → functionDeclarations + native tools
 *                         (web_search → googleSearch, computer_use →
 *                         computerUse, file_search → fileSearch,
 *                         code_execution → codeExecution)
 *     tool_choice       → toolConfig.functionCallingConfig
 *     temperature/top_p/top_k/stop_sequences → same
 *     max_tokens        → maxOutputTokens
 *     thinking.budget_tokens → thinkingConfig
 *
 *   Response  GenerateContentResponse → AnthropicMessage
 *     parts text         → content[] {type:'text'}
 *     parts functionCall → content[] {type:'tool_use'}
 *     parts thought      → content[] {type:'thinking'}
 *     finishReason       → stop_reason (mapped)
 *     usageMetadata      → usage (input/output/cache_read)
 */

// ─── Request side ──────────────────────────────────────────────────

export function requestAnthropicToGemini(
  req: AnthropicMessagesRequest
): GenerateContentParameters {
  const contents: Content[] = [];
  const systemTexts: string[] = [];

  if (typeof req.system === 'string' && req.system.length > 0) {
    systemTexts.push(req.system);
  } else if (Array.isArray(req.system)) {
    for (const block of req.system) {
      if (block.type === 'text' && block.text) systemTexts.push(block.text);
    }
  }

  // Gemini's `functionResponse.name` must match the prior
  // `functionCall.name` — `tool_use_id` alone (which is all the
  // Anthropic `tool_result` block carries) is not enough. Walk the
  // history once to build the id → name index so each tool_result can
  // re-attach the function name on the way out.
  const toolUseNameById = new Map<string, string>();
  for (const msg of req.messages) {
    if (msg.role !== 'assistant' || typeof msg.content === 'string') continue;
    for (const block of msg.content) {
      if (block.type === 'tool_use' && block.id && block.name) {
        toolUseNameById.set(block.id, block.name);
      }
    }
  }

  for (const msg of req.messages) {
    const parts = anthropicContentToGeminiParts(msg.content, toolUseNameById);
    if (parts.length === 0) continue;
    contents.push({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts,
    });
  }

  const config: GenerateContentConfig = {};
  if (systemTexts.length > 0) {
    config.systemInstruction = {
      role: 'user',
      parts: [{ text: systemTexts.join('\n\n') }],
    };
  }

  const tools = anthropicToolsToGemini(
    req.tools as AnthropicToolUnion[] | undefined
  );
  if (tools && tools.length > 0) config.tools = tools;
  const toolConfig = anthropicToolChoiceToGemini(req.tool_choice);
  if (toolConfig) config.toolConfig = toolConfig;

  if (req.max_tokens != null) config.maxOutputTokens = req.max_tokens;
  if (req.temperature != null) config.temperature = req.temperature;
  if (req.top_p != null) config.topP = req.top_p;
  if (req.top_k != null) config.topK = req.top_k;
  if (req.stop_sequences && req.stop_sequences.length > 0) {
    config.stopSequences = req.stop_sequences;
  }

  if (req.thinking) {
    if (req.thinking.type === 'enabled') {
      config.thinkingConfig = {
        includeThoughts: true,
        thinkingBudget: req.thinking.budget_tokens ?? -1,
      };
    } else if (req.thinking.type === 'disabled') {
      config.thinkingConfig = { includeThoughts: false, thinkingBudget: 0 };
    }
  }
  // Also honour `reasoning_effort` (Chat-API extension) if the caller
  // routed an Anthropic-input request with the OpenAI-style enum on the
  // outer envelope. Last-write wins so explicit `thinking.budget_tokens`
  // takes precedence.
  if (!config.thinkingConfig) {
    const effort = (req as { reasoning_effort?: string | null })
      .reasoning_effort;
    const inferred = mapReasoningEffortToThinking(effort, req.max_tokens);
    if (inferred) config.thinkingConfig = inferred;
  }

  applyResponseSchema(config, req);
  applyGeminiProviderArgs(config, req);

  return { model: req.model, contents, config };
}

function anthropicContentToGeminiParts(
  content: string | AnthropicContentBlockParam[],
  toolUseNameById: Map<string, string> = new Map()
): Part[] {
  if (typeof content === 'string') {
    return content.length > 0 ? [{ text: content }] : [];
  }
  const parts: Part[] = [];
  for (const block of content) {
    switch (block.type) {
      case 'text':
        if (block.text) parts.push({ text: block.text });
        break;
      case 'image': {
        const src = block.source;
        if (src.type === 'base64') {
          parts.push({
            inlineData: { mimeType: src.media_type, data: src.data },
          });
        } else if (src.type === 'url') {
          parts.push(urlToMediaPart(src.url, 'image/*'));
        }
        break;
      }
      case 'document': {
        const src = block.source;
        if (src.type === 'base64') {
          parts.push({
            inlineData: { mimeType: 'application/pdf', data: src.data },
          });
        } else if (src.type === 'text') {
          const header = block.title ? `# ${block.title}\n\n` : '';
          parts.push({ text: `${header}${src.data}` });
        } else if (src.type === 'url') {
          parts.push(urlToMediaPart(src.url, 'application/pdf'));
        }
        break;
      }
      case 'tool_use':
        parts.push({
          functionCall: {
            id: block.id,
            name: block.name,
            args:
              block.input && typeof block.input === 'object'
                ? (block.input as Record<string, unknown>)
                : {},
          },
        });
        break;
      case 'tool_result': {
        const { output, parts: fnParts } = buildFunctionResponseFromToolResult(
          block.content
        );
        // Gemini correlates `functionResponse.name` against the prior
        // `functionCall.name` — `tool_use_id` (the Anthropic handle) is
        // not a name the model recognises. Fall back to the id only
        // when no matching `tool_use` block appears earlier in the
        // conversation, so the upstream still has something to surface.
        const fnName =
          toolUseNameById.get(block.tool_use_id) ?? block.tool_use_id;
        parts.push({
          functionResponse: {
            id: block.tool_use_id,
            name: fnName,
            response: { output },
            ...(fnParts && fnParts.length > 0 ? { parts: fnParts } : {}),
          },
        });
        break;
      }
      case 'thinking':
        parts.push({
          text: block.thinking,
          thought: true,
          ...(block.signature ? { thoughtSignature: block.signature } : {}),
        });
        break;
      case 'redacted_thinking':
        // No equivalent on Gemini's side — the upstream issues an
        // opaque thoughtSignature; we surface the redacted blob as
        // signature so multi-turn replay still works.
        parts.push({
          text: '',
          thought: true,
          thoughtSignature: block.data,
        });
        break;
      default:
        // Server-tool history blocks (web_search_tool_result,
        // *_code_execution_tool_result, container_upload, etc.) have
        // no first-class Gemini slot. Dropping them would corrupt
        // multi-turn semantics — the model would see its own prior
        // tool-invocation question in user turns but lose the
        // assistant-side result. Lift to text instead.
        if (isServerToolHistoryBlock(block)) {
          const lifted = liftAnthropicServerToolBlockToText(block);
          if (lifted) parts.push({ text: lifted.text });
        }
        break;
    }
  }
  return parts;
}

/**
 * Anthropic `tool_result.content` can carry text + image + document
 * blocks. Gemini's `FunctionResponse` separates JSON-encoded text
 * (`response.output`) from media (`parts[]` of `inlineData` / `fileData`).
 * Split accordingly so multimodal tool results survive the hop.
 */
function buildFunctionResponseFromToolResult(
  content: ToolResultBlockParam['content']
): { output: string; parts?: FunctionResponsePart[] } {
  if (typeof content === 'string') return { output: content };
  if (!content) return { output: '' };
  const texts: string[] = [];
  const parts: FunctionResponsePart[] = [];
  for (const block of content) {
    if (block.type === 'text' && block.text) {
      texts.push(block.text);
      continue;
    }
    if (block.type === 'image') {
      const src = block.source;
      if (src.type === 'base64') {
        parts.push({
          inlineData: { mimeType: src.media_type, data: src.data },
        });
      } else if (src.type === 'url') {
        parts.push(urlToFunctionResponsePart(src.url, 'image/*'));
      }
      continue;
    }
    if (block.type === 'document') {
      const src = block.source;
      if (src.type === 'base64') {
        parts.push({
          inlineData: { mimeType: src.media_type, data: src.data },
        });
      } else if (src.type === 'text') {
        const header = block.title ? `# ${block.title}\n\n` : '';
        texts.push(`${header}${src.data}`);
      } else if (src.type === 'url') {
        parts.push(urlToFunctionResponsePart(src.url, 'application/pdf'));
      }
      continue;
    }
    // search_result / tool_reference blocks have no Gemini equivalent
    // — drop them rather than guessing a representation.
  }
  return {
    output: texts.join('\n'),
    ...(parts.length > 0 ? { parts } : {}),
  };
}

function anthropicToolsToGemini(
  tools: AnthropicToolUnion[] | undefined
): Tool[] | undefined {
  if (!tools?.length) return undefined;
  const out: Tool[] = [];
  const functionDeclarations: FunctionDeclaration[] = [];
  // Reject — instead of silently dropping — server tools without a
  // Gemini-native equivalent. Customers debugging a "why didn't the
  // model use my tool" pipeline need to see the gateway rejection
  // explicitly; the per-target error code lets dual-route fallbacks
  // branch automatically.
  const unsupported: string[] = [];
  for (const tool of tools) {
    // Gemini-native tool entries (`{googleSearch: {...}}`, etc.) ride
    // through unchanged. The orchestrator merges
    // `vmx.providerArgs.tools` into the top-level body before this
    // converter runs, so callers can override the lossy
    // `web_search → googleSearch:{}` mapping by providing the native
    // shape directly.
    if (isGeminiNativeTool(tool)) {
      out.push(tool as unknown as Tool);
      continue;
    }
    const family = classifyAnthropicServerTool(tool);
    switch (family) {
      case 'custom':
        functionDeclarations.push({
          name: tool.name,
          description: (tool as { description?: string }).description,
          parametersJsonSchema: coerceJsonSchema(
            (tool as { input_schema: unknown }).input_schema
          ),
        });
        break;
      case 'web_search':
        // Anthropic's web-search subfields (`user_location`,
        // `allowed_domains`, `blocked_domains`, `max_uses`) have no
        // Gemini-API equivalents (`excludeDomains` exists on the
        // `GoogleSearch` interface but is Vertex-AI-only, and our
        // connection config supports only the Gemini API today), and
        // Anthropic's shape lacks any recency knob, so there is
        // nothing to lift onto `googleSearch.timeRangeFilter` either.
        // The entire knob set is silently dropped; callers needing
        // native Gemini-side fields can bypass this converter via
        // `vmx.providerArgs.tools`.
        out.push({ googleSearch: {} });
        break;
      case 'web_fetch':
        out.push({ urlContext: {} });
        break;
      case 'code_execution':
        out.push({ codeExecution: {} });
        break;
      case 'computer':
        out.push({ computerUse: {} });
        break;
      default:
        unsupported.push((tool as { type?: string }).type ?? family);
    }
  }
  if (unsupported.length > 0) {
    raiseUnsupportedServerTool(unsupported, 'gemini');
  }
  if (functionDeclarations.length > 0) {
    out.push({ functionDeclarations });
  }
  return out.length > 0 ? out : undefined;
}

function anthropicToolChoiceToGemini(
  choice: AnthropicToolChoice | undefined
): ToolConfig | undefined {
  if (!choice) return undefined;
  switch (choice.type) {
    case 'auto':
      return makeFunctionCallingConfig('auto');
    case 'any':
      return makeFunctionCallingConfig('any');
    case 'none':
      return makeFunctionCallingConfig('none');
    case 'tool':
      return makeFunctionCallingConfig('named', choice.name);
  }
}

function applyResponseSchema(
  config: GenerateContentConfig,
  req: AnthropicMessagesRequest
): void {
  // T-prior: Anthropic's `output_config.format` (Claude 4.5+) lets the
  // caller request a JSON-Schema-constrained response natively. Map
  // onto Gemini's `responseJsonSchema`. The synthetic-tool fallback
  // never lands here — that path triggers a `tool_use` round-trip
  // instead, which we'd handle as a regular tool.
  const outputConfig = (
    req as AnthropicMessagesRequest & {
      output_config?: { format?: { type?: string; schema?: unknown } };
    }
  ).output_config;
  const format = outputConfig?.format as
    | { type?: string; schema?: unknown }
    | undefined;
  if (!format) return;
  if (format.type === 'json_object') {
    config.responseMimeType = 'application/json';
    return;
  }
  if (format.type === 'json_schema' && format.schema) {
    config.responseMimeType = 'application/json';
    config.responseJsonSchema = coerceJsonSchema(format.schema);
  }
}

// ─── Response side ─────────────────────────────────────────────────

export function geminiResponseToAnthropic(
  response: GenerateContentResponse,
  model: string
): AnthropicMessage {
  const candidate = response.candidates?.[0];
  const content: AnthropicMessage['content'] = [];
  let hasFunctionCall = false;

  for (const part of candidate?.content?.parts ?? []) {
    if (part.thought && typeof part.text === 'string') {
      content.push({
        type: 'thinking',
        thinking: part.text,
        signature: part.thoughtSignature ?? '',
      });
      continue;
    }
    if (typeof part.text === 'string' && part.text.length > 0) {
      content.push({ type: 'text', text: part.text, citations: null });
    }
    if (part.functionCall?.name) {
      hasFunctionCall = true;
      const toolUse: ToolUseBlock = {
        type: 'tool_use',
        id: part.functionCall.id ?? `toolu_${uuidv4()}`,
        name: part.functionCall.name,
        input: part.functionCall.args ?? {},
        caller: { type: 'direct' },
      };
      content.push(toolUse);
    }
    // executableCode / codeExecutionResult — no native Anthropic
    // equivalent inside a Message; surface them as text so downstream
    // consumers at least see the executed code. Native passthrough
    // (Bedrock-Invoke `format:'anthropic'`) bypasses this converter.
    if (part.executableCode) {
      content.push({
        type: 'text',
        text: `\`\`\`${part.executableCode.language ?? ''}\n${
          part.executableCode.code ?? ''
        }\n\`\`\``,
        citations: null,
      });
    }
    if (part.codeExecutionResult) {
      content.push({
        type: 'text',
        text: part.codeExecutionResult.output ?? '',
        citations: null,
      });
    }
  }

  const finish = mapFinishReason(candidate?.finishReason, hasFunctionCall);
  const usage = mapUsageMetadata(response.usageMetadata);
  const stopReason = finish.anthropic ?? 'end_turn';

  const message: AnthropicMessage & {
    grounding_metadata?: unknown;
    vertex_ai_grounding_metadata?: unknown;
    url_context_metadata?: unknown;
    prompt_feedback?: unknown;
  } = {
    id: geminiResponseId(response, 'msg'),
    type: 'message',
    role: 'assistant',
    container: null,
    model,
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    stop_details:
      stopReason === 'refusal'
        ? {
            type: 'refusal',
            category: null,
            explanation: candidate?.finishMessage ?? null,
          }
        : null,
    usage: usage.anthropic,
  };
  // Surface Gemini's grounding payload as Anthropic-shape extension
  // fields so callers driving Gemini through the `/anthropic/messages`
  // endpoint can read source rank, segment offsets, and chunk-level
  // provenance — matching what the OpenAI Chat Completions and
  // Responses converters expose for the same upstream candidate.
  if (candidate?.groundingMetadata) {
    message.grounding_metadata = candidate.groundingMetadata;
    message.vertex_ai_grounding_metadata = candidate.groundingMetadata;
  }
  if (candidate?.urlContextMetadata) {
    message.url_context_metadata = candidate.urlContextMetadata;
  }
  if (response.promptFeedback) {
    message.prompt_feedback = response.promptFeedback;
  }
  return message;
}

// ─── Stream side ───────────────────────────────────────────────────

export async function* streamGeminiToAnthropic(
  source: AsyncIterable<GenerateContentResponse>,
  model: string
): AsyncIterable<RawMessageStreamEvent> {
  const messageId = `msg_${uuidv4()}`;
  const accumulator: StreamAccumulator = newStreamAccumulator();
  let messageStartEmitted = false;
  let textBlockOpen = false;
  let textBlockIndex = -1;
  let nextBlockIndex = 0;
  // functionCall id (or auto-key) → Anthropic block index
  const openToolBlocks = new Map<string, number>();
  // Thought block tracking — Anthropic emits one thinking block at
  // start of the response if reasoning is on.
  let thinkingBlockOpen = false;
  let thinkingBlockIndex = -1;
  let thinkingSignature: string | undefined;

  const emitMessageStart = (): RawMessageStartEvent => {
    messageStartEmitted = true;
    const startUsage = mapUsageMetadata(undefined).anthropic;
    return {
      type: 'message_start',
      message: {
        id: messageId,
        type: 'message',
        role: 'assistant',
        container: null,
        content: [],
        model,
        stop_reason: null,
        stop_sequence: null,
        stop_details: null,
        usage: startUsage,
      },
    };
  };

  // Buffered events so the per-block close helpers can synthesise
  // events without being yield-able themselves (`function*` can't
  // delegate yield from a nested arrow).
  const pending: RawMessageStreamEvent[] = [];
  const drain = function* (): Generator<
    RawMessageStreamEvent,
    void,
    undefined
  > {
    while (pending.length > 0) {
      const ev = pending.shift();
      if (ev) yield ev;
    }
  };

  const closeThinking = (): void => {
    if (!thinkingBlockOpen) return;
    if (thinkingSignature) {
      pending.push({
        type: 'content_block_delta',
        index: thinkingBlockIndex,
        delta: { type: 'signature_delta', signature: thinkingSignature },
      });
    }
    pending.push({
      type: 'content_block_stop',
      index: thinkingBlockIndex,
    });
    thinkingBlockOpen = false;
  };

  const closeText = (): void => {
    if (!textBlockOpen) return;
    pending.push({ type: 'content_block_stop', index: textBlockIndex });
    textBlockOpen = false;
  };

  for await (const chunk of source) {
    if (!messageStartEmitted) yield emitMessageStart();
    if (chunk.usageMetadata) accumulator.usage = chunk.usageMetadata;
    const candidate = chunk.candidates?.[0];
    if (candidate?.finishReason)
      accumulator.finishReason = candidate.finishReason;
    // Grounding metadata can land on any chunk (typically the last
    // one). Stash the latest snapshot so the closing `message_delta`
    // can surface it as Anthropic-shape extension fields — parity
    // with the Chat Completions and Responses converters.
    if (candidate?.groundingMetadata) {
      accumulator.grounding = candidate.groundingMetadata;
    }
    if (candidate?.urlContextMetadata) {
      accumulator.urlContext = candidate.urlContextMetadata;
    }

    for (const part of candidate?.content?.parts ?? []) {
      if (part.thought && typeof part.text === 'string') {
        if (!thinkingBlockOpen) {
          // Thinking can only lead the response; if any other block is
          // already open Anthropic's contract says we close it first.
          closeText();
          thinkingBlockIndex = nextBlockIndex++;
          const thinkingStart: ThinkingBlock = {
            type: 'thinking',
            thinking: '',
            signature: '',
          };
          pending.push({
            type: 'content_block_start',
            index: thinkingBlockIndex,
            content_block: thinkingStart,
          });
          thinkingBlockOpen = true;
        }
        pending.push({
          type: 'content_block_delta',
          index: thinkingBlockIndex,
          delta: { type: 'thinking_delta', thinking: part.text },
        });
        if (part.thoughtSignature) thinkingSignature = part.thoughtSignature;
        continue;
      }
      if (typeof part.text === 'string' && part.text.length > 0) {
        if (!textBlockOpen) {
          closeThinking();
          textBlockIndex = nextBlockIndex++;
          const textBlock: TextBlock = {
            type: 'text',
            text: '',
            citations: null,
          };
          pending.push({
            type: 'content_block_start',
            index: textBlockIndex,
            content_block: textBlock,
          });
          textBlockOpen = true;
        }
        pending.push({
          type: 'content_block_delta',
          index: textBlockIndex,
          delta: { type: 'text_delta', text: part.text } satisfies TextDelta,
        });
      }
      if (part.functionCall?.name) {
        accumulator.hasFunctionCall = true;
        const key = part.functionCall.id ?? `auto_${openToolBlocks.size}`;
        if (!openToolBlocks.has(key)) {
          // Anthropic blocks are emitted sequentially — close the
          // open text/thinking block before opening a new tool_use.
          closeText();
          closeThinking();
          const idx = nextBlockIndex++;
          openToolBlocks.set(key, idx);
          const toolUse: ToolUseBlock = {
            type: 'tool_use',
            id: key,
            name: part.functionCall.name,
            input: {},
            caller: { type: 'direct' },
          };
          pending.push({
            type: 'content_block_start',
            index: idx,
            content_block: toolUse,
          });
          // Emit the full args as a single input_json_delta since
          // Gemini doesn't stream partial args.
          pending.push({
            type: 'content_block_delta',
            index: idx,
            delta: {
              type: 'input_json_delta',
              partial_json: JSON.stringify(part.functionCall.args ?? {}),
            },
          });
        }
      }
    }
    yield* drain();
  }

  if (!messageStartEmitted) yield emitMessageStart();
  closeThinking();
  closeText();
  for (const idx of openToolBlocks.values()) {
    pending.push({ type: 'content_block_stop', index: idx });
  }
  yield* drain();

  const finish = mapFinishReason(
    accumulator.finishReason,
    accumulator.hasFunctionCall
  );
  const usage = mapUsageMetadata(accumulator.usage);
  const messageDelta: RawMessageDeltaEvent & {
    grounding_metadata?: unknown;
    vertex_ai_grounding_metadata?: unknown;
    url_context_metadata?: unknown;
  } = {
    type: 'message_delta',
    delta: {
      container: null,
      stop_details: null,
      stop_reason: finish.anthropic ?? 'end_turn',
      stop_sequence: null,
    },
    usage: usage.anthropic,
  };
  // Streaming parity with the non-stream converter — emit the
  // accumulated grounding payload on the closing `message_delta` as
  // Anthropic-shape extension fields. Direct API consumers iterating
  // the SSE stream see the same `vertex_ai_grounding_metadata` /
  // `grounding_metadata` keys both modes expose.
  if (accumulator.grounding) {
    messageDelta.grounding_metadata = accumulator.grounding;
    messageDelta.vertex_ai_grounding_metadata = accumulator.grounding;
  }
  if (accumulator.urlContext) {
    messageDelta.url_context_metadata = accumulator.urlContext;
  }
  yield messageDelta;
  const messageStop: RawMessageStopEvent = { type: 'message_stop' };
  yield messageStop;
}

// ─── Provider class ───────────────────────────────────────────────

/**
 * Gemini's Anthropic-Messages input handler. Always routes through
 * the native `@google/genai` SDK via `GeminiDispatcher`.
 */
@Injectable()
export class GeminiAnthropicMessagesProvider {
  constructor(private readonly dispatcher: GeminiDispatcher) {}

  async handle(
    request: AnthropicMessagesRequest,
    connection: AIConnectionEntity<GeminiConnectionConfig>,
    model: AIResourceModelConfigEntity,
    options?: CompletionRequestOptions
  ): Promise<AnthropicMessagesResponse> {
    const params = requestAnthropicToGemini(request);
    params.model = model.model;

    if (request.stream) {
      const native = await this.dispatcher.dispatchStream(
        params,
        connection,
        options
      );
      return {
        data: streamGeminiToAnthropic(native.data, model.model),
        headers: {},
        providerRequestPayload: native.providerRequestPayload,
      };
    }

    const native = await this.dispatcher.dispatch(params, connection, options);
    return {
      data: geminiResponseToAnthropic(native.data, model.model),
      headers: {},
      providerRequestPayload: native.providerRequestPayload,
    };
  }
}
