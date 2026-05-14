import { Injectable } from '@nestjs/common';
import type {
  Response as OpenAIResponse,
  ResponseCodeInterpreterToolCall,
  ResponseCompletedEvent,
  ResponseContentPartAddedEvent,
  ResponseContentPartDoneEvent,
  ResponseCreatedEvent,
  ResponseCreateParams,
  ResponseFunctionCallArgumentsDeltaEvent,
  ResponseFunctionCallArgumentsDoneEvent,
  ResponseFunctionToolCall,
  ResponseInProgressEvent,
  ResponseInputContent,
  ResponseInputItem,
  ResponseOutputItem,
  ResponseOutputItemAddedEvent,
  ResponseOutputItemDoneEvent,
  ResponseOutputMessage,
  ResponseOutputText,
  ResponseOutputTextAnnotationAddedEvent,
  ResponseReasoningItem,
  ResponseReasoningSummaryPartAddedEvent,
  ResponseReasoningSummaryPartDoneEvent,
  ResponseReasoningSummaryTextDeltaEvent,
  ResponseReasoningSummaryTextDoneEvent,
  ResponseStreamEvent,
  ResponseTextDeltaEvent,
  ResponseTextDoneEvent,
  Tool as ResponsesTool,
} from 'openai/resources/responses/responses.js';
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
  CompletionRequestOptions,
  OpenAIResponseResponse,
} from '../ai-provider.types';
import { stripPassthroughEnvelope } from '../passthrough.helpers';
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
  parseToolCallArguments,
  recencyFilterToTimeRange,
  urlToFunctionResponsePart,
  urlToMediaPart,
} from './shared';

/**
 * Gemini's OpenAI-Responses input handler — direct one-pair Responses
 * ↔ Gemini-native converter. No pivot through ChatCompletion; the SDK
 * call goes through `GeminiDispatcher`.
 *
 * Mapping summary:
 *
 *   Request  Responses → Gemini
 *     instructions    → systemInstruction
 *     input (string)  → contents [{role:'user', parts:[{text}]}]
 *     input (items)
 *       message       → Content with parts (text / image / file)
 *       function_call → Content (role:'model') with functionCall part
 *       function_call_output → Content (role:'user') with functionResponse part
 *       reasoning     → Content (role:'model') with thought:true part
 *     tools (function)         → functionDeclarations
 *     tools (hosted, web_search/file_search/code_interpreter) → native Tool
 *     temperature, top_p       → temperature, topP
 *     max_output_tokens        → maxOutputTokens
 *     stop                     → stopSequences (none on Responses today)
 *     tool_choice              → toolConfig.functionCallingConfig.mode
 *     reasoning.effort         → thinkingConfig
 *     text.format (json_schema)→ responseMimeType + responseJsonSchema
 *
 *   Response  GenerateContentResponse → Response
 *     candidate.content.parts
 *       text          → output[] message → output_text part
 *       thought       → output[] reasoning → summary text
 *       functionCall  → output[] function_call (call_id, name, args)
 *       executableCode/codeExecutionResult → output[] code_interpreter_call
 *     usageMetadata    → usage (input_tokens / output_tokens / details)
 *     finishReason     → status (STOP / MAX_TOKENS / SAFETY → mapped)
 */

// ─── Request side ──────────────────────────────────────────────────

export function requestResponsesToGemini(
  req: ResponseCreateParams
): GenerateContentParameters {
  const sanitised = stripPassthroughEnvelope(req);
  const contents: Content[] = [];
  const systemTexts: string[] = [];

  if (typeof sanitised.instructions === 'string' && sanitised.instructions) {
    systemTexts.push(sanitised.instructions);
  }

  const input = sanitised.input;
  if (typeof input === 'string') {
    if (input.length > 0) {
      contents.push({ role: 'user', parts: [{ text: input }] });
    }
  } else if (Array.isArray(input)) {
    // Gemini's `functionResponse.name` must match the prior
    // `functionCall.name` — the OpenAI `call_id` handle alone breaks
    // the round-trip. Pre-walk the items to build an id → name index
    // so each `function_call_output` can re-attach the function name.
    const toolCallNameById = new Map<string, string>();
    for (const item of input) {
      if ((item as { type?: string }).type === 'function_call') {
        const fc = item as Extract<
          ResponseInputItem,
          { type: 'function_call' }
        >;
        if (fc.call_id && fc.name) toolCallNameById.set(fc.call_id, fc.name);
      }
    }
    let pendingToolResponses: Part[] = [];
    const flushPending = () => {
      if (pendingToolResponses.length === 0) return;
      contents.push({ role: 'user', parts: pendingToolResponses });
      pendingToolResponses = [];
    };
    for (const item of input) {
      const handled = appendResponsesInputItem(
        item,
        contents,
        systemTexts,
        toolCallNameById
      );
      if (handled?.toolResponse) {
        pendingToolResponses.push(handled.toolResponse);
      } else {
        flushPending();
      }
    }
    flushPending();
  }

  const config: GenerateContentConfig = {};
  if (systemTexts.length > 0) {
    config.systemInstruction = {
      role: 'user',
      parts: [{ text: systemTexts.join('\n\n') }],
    };
  }

  const tools = responsesToolsToGemini(sanitised.tools);
  if (tools && tools.length > 0) config.tools = tools;
  const toolConfig = responsesToolChoiceToGemini(sanitised.tool_choice);
  if (toolConfig) config.toolConfig = toolConfig;

  const maxTokens = sanitised.max_output_tokens;
  if (maxTokens != null) config.maxOutputTokens = maxTokens;
  if (sanitised.temperature != null) config.temperature = sanitised.temperature;
  if (sanitised.top_p != null) config.topP = sanitised.top_p;

  const reasoning = (
    sanitised as ResponseCreateParams & {
      reasoning?: { effort?: string | null } | null;
    }
  ).reasoning;
  const thinking = mapReasoningEffortToThinking(
    reasoning?.effort,
    maxTokens ?? undefined
  );
  if (thinking) config.thinkingConfig = thinking;

  applyResponsesTextFormat(config, sanitised);
  applyGeminiProviderArgs(config, sanitised);

  return { model: sanitised.model ?? 'gemini', contents, config };
}

function appendResponsesInputItem(
  item: ResponseInputItem,
  contents: Content[],
  systemTexts: string[],
  toolCallNameById: Map<string, string>
): { toolResponse?: Part } | undefined {
  const itemType = (item as { type?: string }).type;
  // Message items have an optional `type: 'message'` (or undefined),
  // a `role`, and a `content` field.
  if (itemType === undefined || itemType === 'message') {
    const msg = item as Extract<ResponseInputItem, { content?: unknown }>;
    const role = (msg as { role?: string }).role ?? 'user';
    const parts = mapResponsesContentToParts(
      (msg as { content?: ResponseInputContent[] | string }).content
    );
    if (role === 'system' || role === 'developer') {
      for (const p of parts) {
        if (typeof p.text === 'string') systemTexts.push(p.text);
      }
      return;
    }
    if (parts.length === 0) return;
    contents.push({ role: role === 'assistant' ? 'model' : 'user', parts });
    return;
  }
  if (itemType === 'function_call') {
    const fc = item as Extract<ResponseInputItem, { type: 'function_call' }>;
    contents.push({
      role: 'model',
      parts: [
        {
          functionCall: {
            id: fc.call_id,
            name: fc.name,
            args: parseToolCallArguments(fc.arguments),
          },
        },
      ],
    });
    return;
  }
  if (itemType === 'function_call_output') {
    const out = item as Extract<
      ResponseInputItem,
      { type: 'function_call_output' }
    >;
    const { output: text, parts: fnParts } = buildFunctionCallOutput(
      out.output
    );
    // Gemini's `functionResponse.name` must match the prior
    // `functionCall.name` for the model to correlate the response with
    // the original call. Falls back to `call_id` only when no matching
    // function_call appears earlier in the conversation — better to
    // send something than to drop the part entirely.
    const fnName = toolCallNameById.get(out.call_id) ?? out.call_id;
    return {
      toolResponse: {
        functionResponse: {
          id: out.call_id,
          name: fnName,
          response: { output: text },
          ...(fnParts && fnParts.length > 0 ? { parts: fnParts } : {}),
        },
      },
    };
  }
  if (itemType === 'reasoning') {
    const reason = item as Extract<ResponseInputItem, { type: 'reasoning' }>;
    const summary = (reason.summary ?? [])
      .map((s) => (typeof s.text === 'string' ? s.text : ''))
      .filter(Boolean)
      .join('\n');
    const signature = (reason as { encrypted_content?: string })
      .encrypted_content;
    if (summary.length > 0 || signature) {
      contents.push({
        role: 'model',
        parts: [
          {
            text: summary,
            thought: true,
            ...(signature ? { thoughtSignature: signature } : {}),
          },
        ],
      });
    }
    return;
  }
  // Other item types (web_search_call, file_search_call,
  // computer_call, image_generation_call, etc.) have no direct Gemini
  // representation — drop silently. The native upstream surfaces them
  // on response, not on input replay.
  return;
}

function mapResponsesContentToParts(
  content: ResponseInputContent[] | string | undefined
): Part[] {
  if (content == null) return [];
  if (typeof content === 'string') {
    return content.length > 0 ? [{ text: content }] : [];
  }
  const parts: Part[] = [];
  for (const piece of content) {
    const type = (piece as { type?: string }).type;
    if (type === 'input_text' || type === 'output_text') {
      const text = (piece as { text?: string }).text;
      if (text) parts.push({ text });
      continue;
    }
    if (type === 'input_image') {
      const img = piece as { image_url?: string | { url: string } };
      const url =
        typeof img.image_url === 'string' ? img.image_url : img.image_url?.url;
      if (typeof url === 'string') {
        parts.push(urlToMediaPart(url, 'image/*'));
      }
      continue;
    }
    if (type === 'input_file') {
      const file = piece as {
        file_data?: string;
        file_url?: string;
        file_id?: string;
        filename?: string;
      };
      if (file.file_data) {
        parts.push(urlToMediaPart(file.file_data, 'application/pdf'));
      } else if (file.file_url) {
        parts.push(urlToMediaPart(file.file_url, 'application/pdf'));
      } else if (file.file_id) {
        parts.push({
          fileData: {
            fileUri: file.file_id,
            mimeType: 'application/octet-stream',
          },
        });
      }
      continue;
    }
    if (type === 'input_audio') {
      const audio = piece as {
        input_audio?: { data?: string; format?: string };
      };
      const data = audio.input_audio?.data;
      if (data) {
        const mimeType = audio.input_audio?.format
          ? `audio/${audio.input_audio.format}`
          : 'audio/mp3';
        parts.push({ inlineData: { mimeType, data } });
      }
    }
  }
  return parts;
}

/**
 * Responses `function_call_output.output` is `string | Array<input_text |
 * input_image | input_file>`. Gemini's `FunctionResponse` separates
 * JSON-encoded text (`response.output`) from media (`parts[]` of
 * `inlineData` / `fileData`). Split accordingly so multimodal tool
 * results survive the hop.
 */
function buildFunctionCallOutput(
  output: ResponseInputItem.FunctionCallOutput['output']
): { output: string; parts?: FunctionResponsePart[] } {
  if (typeof output === 'string') return { output };
  if (!Array.isArray(output)) return { output: '' };
  const texts: string[] = [];
  const parts: FunctionResponsePart[] = [];
  for (const piece of output) {
    const type = (piece as { type?: string }).type;
    if (type === 'input_text' || type === 'output_text') {
      const text = (piece as { text?: string }).text;
      if (text) texts.push(text);
      continue;
    }
    if (type === 'input_image') {
      const img = piece as {
        image_url?: string | null;
        file_id?: string | null;
      };
      if (typeof img.image_url === 'string') {
        parts.push(urlToFunctionResponsePart(img.image_url, 'image/*'));
      } else if (img.file_id) {
        parts.push({
          fileData: { fileUri: img.file_id, mimeType: 'image/*' },
        });
      }
      continue;
    }
    if (type === 'input_file') {
      const file = piece as {
        file_data?: string | null;
        file_url?: string | null;
        file_id?: string | null;
      };
      if (file.file_data) {
        parts.push(
          urlToFunctionResponsePart(file.file_data, 'application/pdf')
        );
      } else if (file.file_url) {
        parts.push(urlToFunctionResponsePart(file.file_url, 'application/pdf'));
      } else if (file.file_id) {
        parts.push({
          fileData: {
            fileUri: file.file_id,
            mimeType: 'application/octet-stream',
          },
        });
      }
    }
  }
  return {
    output: texts.join('\n'),
    ...(parts.length > 0 ? { parts } : {}),
  };
}

function responsesToolsToGemini(
  tools: ResponsesTool[] | null | undefined
): Tool[] | undefined {
  if (!tools?.length) return undefined;
  const out: Tool[] = [];
  const functionDeclarations: FunctionDeclaration[] = [];
  for (const tool of tools) {
    const t = tool as Record<string, unknown> & { type?: string };
    // Gemini-native tool entries (`{googleSearch: {...}}`,
    // `{urlContext: {}}`, etc.) ride through unchanged. This is how
    // callers escape the cross-format converter's lossy
    // `web_search → googleSearch:{}` mapping — the orchestrator merges
    // `vmx.providerArgs.tools` into the top-level body, so a caller
    // requesting `{googleSearch: {timeRangeFilter, excludeDomains}}`
    // lands here as a native passthrough.
    if (isGeminiNativeTool(t)) {
      out.push(t as unknown as Tool);
      continue;
    }
    if (t.type === 'function') {
      const fn = tool as Extract<ResponsesTool, { type: 'function' }>;
      functionDeclarations.push({
        name: fn.name,
        description: fn.description ?? undefined,
        parametersJsonSchema: coerceJsonSchema(fn.parameters),
      });
      continue;
    }
    // Responses' hosted tools — `web_search`, `web_search_preview`,
    // `file_search`, `code_interpreter`, `image_generation` — map onto
    // their Gemini equivalents. Unknown hosted tools fall through.
    if (t.type === 'web_search' || t.type === 'web_search_preview') {
      // Responses' web-search subfields don't all have a Gemini-API
      // equivalent. What survives the hop:
      //   - `filters.search_recency_filter` → `googleSearch.timeRangeFilter`
      //     (Gemini-API-only field; Vertex AI rejects it, but our
      //     connection config only supports the Gemini API today)
      // What gets dropped (no Gemini-API equivalent):
      //   - `user_location`            (no analogue on `GoogleSearch`)
      //   - `filters.allowed_domains`  (Gemini has only a blocklist)
      //   - `filters.blocked_domains`  (`excludeDomains` is Vertex-only)
      //   - `filters.search_domain_filter` (Perplexity-only field)
      // Callers needing the Vertex-side knobs (or any other native
      // shape) can bypass the converter via `vmx.providerArgs.tools`,
      // which fully replaces this output.
      const filters = (t as { filters?: Record<string, unknown> }).filters;
      const timeRangeFilter = recencyFilterToTimeRange(
        filters?.search_recency_filter as string | undefined
      );
      const googleSearch: Record<string, unknown> = {};
      if (timeRangeFilter) googleSearch.timeRangeFilter = timeRangeFilter;
      out.push({ googleSearch });
      continue;
    }
    if (t.type === 'file_search') {
      out.push({ fileSearch: {} });
      continue;
    }
    if (t.type === 'code_interpreter') {
      out.push({ codeExecution: {} });
      continue;
    }
  }
  if (functionDeclarations.length > 0) {
    out.push({ functionDeclarations });
  }
  return out.length > 0 ? out : undefined;
}

function responsesToolChoiceToGemini(
  choice: ResponseCreateParams['tool_choice']
): ToolConfig | undefined {
  if (choice == null) return undefined;
  if (choice === 'auto') return makeFunctionCallingConfig('auto');
  if (choice === 'required') return makeFunctionCallingConfig('any');
  if (choice === 'none') return makeFunctionCallingConfig('none');
  if (typeof choice === 'object' && choice && 'type' in choice) {
    if (choice.type === 'function' && (choice as { name?: string }).name) {
      return makeFunctionCallingConfig(
        'named',
        (choice as { name: string }).name
      );
    }
  }
  return undefined;
}

function applyResponsesTextFormat(
  config: GenerateContentConfig,
  request: ResponseCreateParams
): void {
  const text = (
    request as ResponseCreateParams & {
      text?: {
        format?: {
          type?: string;
          schema?: Record<string, unknown>;
          name?: string;
        };
      };
    }
  ).text;
  const format = text?.format;
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

// ─── Grounding helpers ─────────────────────────────────────────────

type UrlCitationAnnotation = ResponseOutputText.URLCitation;

/**
 * Gemini groundingMetadata → Responses `url_citation` annotations.
 *
 * `groundingSupports[]` ties text segments (with `startIndex`/`endIndex`
 * byte offsets within a Part) to the `groundingChunks[]` array via
 * `groundingChunkIndices`. We fan a single support across each cited
 * chunk so a sentence backed by N sources surfaces as N annotations
 * with matching offsets. When supports are missing (some Gemini surfaces
 * only return chunks), we emit one zero-offset annotation per chunk so
 * the citations still surface to the client.
 */
function groundingChunksToAnnotations(
  grounding:
    | {
        groundingChunks?: Array<{
          web?: { uri?: string; title?: string };
        }>;
        groundingSupports?: Array<{
          segment?: { startIndex?: number; endIndex?: number };
          groundingChunkIndices?: number[];
        }>;
      }
    | undefined
): UrlCitationAnnotation[] {
  if (!grounding) return [];
  const chunks = grounding.groundingChunks ?? [];
  if (chunks.length === 0) return [];
  const supports = grounding.groundingSupports ?? [];
  const out: UrlCitationAnnotation[] = [];
  if (supports.length > 0) {
    for (const support of supports) {
      const start = support.segment?.startIndex ?? 0;
      const end = support.segment?.endIndex ?? 0;
      for (const idx of support.groundingChunkIndices ?? []) {
        const chunk = chunks[idx];
        const web = chunk?.web;
        if (!web?.uri) continue;
        out.push({
          type: 'url_citation',
          url: web.uri,
          title: web.title ?? '',
          start_index: start,
          end_index: end,
        });
      }
    }
    if (out.length > 0) return out;
  }
  for (const chunk of chunks) {
    const web = chunk?.web;
    if (!web?.uri) continue;
    out.push({
      type: 'url_citation',
      url: web.uri,
      title: web.title ?? '',
      start_index: 0,
      end_index: 0,
    });
  }
  return out;
}

// ─── Response side ─────────────────────────────────────────────────

export function geminiResponseToResponses(
  response: GenerateContentResponse,
  model: string,
  request: ResponseCreateParams
): OpenAIResponse {
  const candidate = response.candidates?.[0];
  const output: ResponseOutputItem[] = [];

  const messageContent: ResponseOutputText[] = [];
  let hasFunctionCall = false;
  let messageEmitted = false;

  const annotations = groundingChunksToAnnotations(
    candidate?.groundingMetadata as Parameters<
      typeof groundingChunksToAnnotations
    >[0]
  );

  const flushMessage = (): void => {
    if (messageEmitted || messageContent.length === 0) return;
    const content = messageContent.map((c, i) => ({
      ...c,
      annotations: i === 0 ? [...annotations] : c.annotations,
    }));
    const message: ResponseOutputMessage = {
      id: `msg_${uuidv4()}`,
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content,
    };
    output.push(message);
    messageEmitted = true;
  };

  let thoughtText = '';
  let thoughtSignature: string | undefined;

  for (const part of candidate?.content?.parts ?? []) {
    if (part.thought && typeof part.text === 'string') {
      thoughtText += part.text;
      if (part.thoughtSignature) thoughtSignature = part.thoughtSignature;
      continue;
    }
    if (typeof part.text === 'string' && part.text.length > 0) {
      messageContent.push({
        type: 'output_text',
        text: part.text,
        // Annotations get attached to the first output_text below;
        // pushing them on every fragment would duplicate citations.
        annotations: [],
      });
    }
    if (part.functionCall?.name) {
      hasFunctionCall = true;
      flushMessage();
      const fnCall: ResponseFunctionToolCall = {
        id: `fc_${uuidv4()}`,
        type: 'function_call',
        call_id: part.functionCall.id ?? `call_${output.length}`,
        name: part.functionCall.name,
        arguments: JSON.stringify(part.functionCall.args ?? {}),
        status: 'completed',
      };
      output.push(fnCall);
    }
    if (part.executableCode || part.codeExecutionResult) {
      flushMessage();
      const codeCall: ResponseCodeInterpreterToolCall = {
        id: `ci_${uuidv4()}`,
        type: 'code_interpreter_call',
        status: 'completed',
        code: part.executableCode?.code ?? null,
        container_id: '',
        outputs: part.codeExecutionResult
          ? [{ type: 'logs', logs: part.codeExecutionResult.output ?? '' }]
          : null,
      };
      output.push(codeCall);
    }
  }

  if (thoughtText.length > 0 || thoughtSignature) {
    // Reasoning items go before the message in the Responses output.
    const reasoning: ResponseReasoningItem = {
      id: `rs_${uuidv4()}`,
      type: 'reasoning',
      summary:
        thoughtText.length > 0
          ? [{ type: 'summary_text', text: thoughtText }]
          : [],
      ...(thoughtSignature ? { encrypted_content: thoughtSignature } : {}),
    };
    output.unshift(reasoning);
  }

  flushMessage();

  // Prompt-level safety blocks come back with `promptFeedback.blockReason`
  // and no candidate. The candidate-level `mapFinishReason` would default
  // to `'stop'` in that case; promote to `'content_filter'` so the
  // Responses client sees `status: 'incomplete'` + the proper reason.
  const promptBlockReason = (
    response.promptFeedback as { blockReason?: string } | undefined
  )?.blockReason;
  const promptBlocked = !candidate && Boolean(promptBlockReason);
  const finish = promptBlocked
    ? { openai: 'content_filter' as const, anthropic: 'refusal' as const }
    : mapFinishReason(candidate?.finishReason, hasFunctionCall);
  const usage = mapUsageMetadata(response.usageMetadata);
  const id = geminiResponseId(response, 'resp');
  const statusInfo = mapResponseStatus(finish.openai);

  const result: OpenAIResponse & {
    grounding_metadata?: unknown;
    vertex_ai_grounding_metadata?: unknown;
    url_context_metadata?: unknown;
    prompt_feedback?: unknown;
  } = {
    id,
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    model,
    status: statusInfo.status,
    output,
    output_text: joinOutputText(output),
    incomplete_details: statusInfo.incompleteDetails,
    metadata: request.metadata ?? null,
    parallel_tool_calls: request.parallel_tool_calls ?? true,
    tool_choice: request.tool_choice ?? 'auto',
    tools: request.tools ?? [],
    temperature: request.temperature ?? null,
    top_p: request.top_p ?? null,
    max_output_tokens: request.max_output_tokens ?? null,
    instructions: request.instructions ?? null,
    previous_response_id: request.previous_response_id ?? null,
    reasoning: request.reasoning ?? null,
    text: request.text ?? undefined,
    truncation: request.truncation ?? null,
    usage: usage.responses,
    error: null,
    user: request.user,
  };
  // Surface the raw Gemini grounding payload as Responses-shape
  // extension fields so callers that need the source rank, segment
  // offsets, or chunk-level provenance can read them directly — same
  // contract the Chat Completions converter exposes via
  // `completion.vertex_ai_grounding_metadata`. The `url_citation`
  // annotations attached to `output[0].content[0]` above stay the
  // primary, schema-compatible signal for clients that only want the
  // citation list.
  if (candidate?.groundingMetadata) {
    result.grounding_metadata = candidate.groundingMetadata;
    result.vertex_ai_grounding_metadata = candidate.groundingMetadata;
  }
  if (candidate?.urlContextMetadata) {
    result.url_context_metadata = candidate.urlContextMetadata;
  }
  if (response.promptFeedback) {
    result.prompt_feedback = response.promptFeedback;
  }
  return result;
}

function joinOutputText(items: ResponseOutputItem[]): string {
  let out = '';
  for (const item of items) {
    if (item.type !== 'message') continue;
    for (const part of item.content ?? []) {
      if (part.type === 'output_text') out += part.text;
    }
  }
  return out;
}

/**
 * Map the normalised finish + safety state onto the OpenAI Responses
 * `status` + `incomplete_details`. The Responses contract:
 *   - `completed` — normal stop or tool_calls.
 *   - `incomplete` + `{ reason: 'max_output_tokens' }` — truncated.
 *   - `incomplete` + `{ reason: 'content_filter' }` — refusal / safety.
 * Anything else stays `completed` (best-effort fallback).
 */
function mapResponseStatus(
  finish: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'function_call'
): {
  status: OpenAIResponse['status'];
  incompleteDetails: OpenAIResponse['incomplete_details'];
} {
  if (finish === 'length') {
    return {
      status: 'incomplete',
      incompleteDetails: { reason: 'max_output_tokens' },
    };
  }
  if (finish === 'content_filter') {
    return {
      status: 'incomplete',
      incompleteDetails: { reason: 'content_filter' },
    };
  }
  return { status: 'completed', incompleteDetails: null };
}

/**
 * Rebuild the streaming `response.completed` event's `output[]` from
 * the events we already yielded — function-call items closed via the
 * `output_item.done` events, plus a synthetic `message` item if any
 * text was streamed. Without this the closing `response.completed`
 * carries an empty `output`, breaking clients that consume the final
 * snapshot instead of replaying each event.
 */
function collectFinalOutput(args: {
  completedFunctionCalls: ResponseFunctionToolCall[];
  textBuffer: string;
  messageItemId: string | undefined;
  annotations: UrlCitationAnnotation[];
  reasoning?: {
    id: string;
    text: string;
    encryptedContent?: string;
  };
}): ResponseOutputItem[] {
  const out: ResponseOutputItem[] = [];
  if (args.reasoning) {
    const reasoningItem: ResponseReasoningItem = {
      id: args.reasoning.id,
      type: 'reasoning',
      summary:
        args.reasoning.text.length > 0
          ? [{ type: 'summary_text', text: args.reasoning.text }]
          : [],
      ...(args.reasoning.encryptedContent
        ? { encrypted_content: args.reasoning.encryptedContent }
        : {}),
    };
    out.push(reasoningItem);
  }
  if (args.textBuffer.length > 0 && args.messageItemId) {
    const msg: ResponseOutputMessage = {
      id: args.messageItemId,
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [
        {
          type: 'output_text',
          text: args.textBuffer,
          annotations: [...args.annotations],
        },
      ],
    };
    out.push(msg);
  }
  for (const fc of args.completedFunctionCalls) out.push(fc);
  return out;
}

/**
 * Stable key for an annotation so streaming can dedupe across chunks —
 * Gemini repeats the full `groundingMetadata` on each delta, so without
 * a dedupe the same `url_citation` would fire on every iteration.
 */
function annotationKey(a: UrlCitationAnnotation): string {
  return `${a.url}|${a.start_index ?? 0}|${a.end_index ?? 0}`;
}

// ─── Stream side ───────────────────────────────────────────────────

export async function* streamGeminiToResponses(
  source: AsyncIterable<GenerateContentResponse>,
  model: string,
  request: ResponseCreateParams
): AsyncIterable<ResponseStreamEvent> {
  const id = `resp_${uuidv4()}`;
  const createdAt = Math.floor(Date.now() / 1000);
  const accumulator: StreamAccumulator = newStreamAccumulator();

  const shell = makeShellResponse(id, createdAt, model, request);
  let seq = 0;
  const createdEvent: ResponseCreatedEvent = {
    type: 'response.created',
    response: shell,
    sequence_number: seq++,
  };
  yield createdEvent;
  const inProgressEvent: ResponseInProgressEvent = {
    type: 'response.in_progress',
    response: shell,
    sequence_number: seq++,
  };
  yield inProgressEvent;

  // Pending buffer for events produced inside the nested `closeMessage`
  // helper — nested functions can't `yield` to the enclosing generator,
  // so we queue and drain at safe points instead.
  const pending: ResponseStreamEvent[] = [];
  const drain = function* (): Generator<ResponseStreamEvent, void, undefined> {
    while (pending.length > 0) {
      const e = pending.shift();
      if (e) yield e;
    }
  };

  let outputIndex = 0;
  let messageItemId: string | undefined;
  let messageOpened = false;
  let textBuffer = '';
  let messageOutputIndex: number | undefined;
  // Streaming annotation state — Gemini repeats the full
  // `groundingMetadata` on each delta chunk, so we dedupe via a key
  // set and only emit `output_text.annotation.added` for newly-seen
  // citations. The accumulated list lands on the closing text_done
  // and content_part.done events so a client replaying the snapshot
  // sees the same set.
  const emittedAnnotationKeys = new Set<string>();
  const streamedAnnotations: UrlCitationAnnotation[] = [];
  // Reasoning streaming state — same pending-buffer pattern as the
  // message helpers below. Tracked separately so a candidate that
  // streams `thought` parts before final-answer text gets its own
  // output_item with the canonical summary_text events.
  let reasoningItemId: string | undefined;
  let reasoningIndex: number | undefined;
  let reasoningOpened = false;
  let reasoningText = '';
  let reasoningSignature: string | undefined;
  // Function-call open state, keyed by Gemini's functionCall id (or
  // an index fallback when missing). `name` is captured at open time
  // so the closing `function_call_arguments.done` + `output_item.done`
  // events can echo the real function name instead of a placeholder.
  const openFunctionCalls = new Map<
    string,
    { id: string; index: number; emittedArgs: string; name: string }
  >();

  const openReasoning = (): void => {
    if (reasoningOpened) return;
    reasoningItemId = `rs_${uuidv4()}`;
    reasoningIndex = outputIndex;
    const item: ResponseReasoningItem = {
      id: reasoningItemId,
      type: 'reasoning',
      summary: [],
      status: 'in_progress',
    };
    const added: ResponseOutputItemAddedEvent = {
      type: 'response.output_item.added',
      output_index: reasoningIndex,
      item,
      sequence_number: seq++,
    };
    pending.push(added);
    const partAdded: ResponseReasoningSummaryPartAddedEvent = {
      type: 'response.reasoning_summary_part.added',
      item_id: reasoningItemId,
      output_index: reasoningIndex,
      summary_index: 0,
      part: { type: 'summary_text', text: '' },
      sequence_number: seq++,
    };
    pending.push(partAdded);
    reasoningOpened = true;
  };

  const closeReasoning = (): void => {
    if (!reasoningOpened || !reasoningItemId || reasoningIndex === undefined) {
      return;
    }
    const textDone: ResponseReasoningSummaryTextDoneEvent = {
      type: 'response.reasoning_summary_text.done',
      item_id: reasoningItemId,
      output_index: reasoningIndex,
      summary_index: 0,
      text: reasoningText,
      sequence_number: seq++,
    };
    pending.push(textDone);
    const partDone: ResponseReasoningSummaryPartDoneEvent = {
      type: 'response.reasoning_summary_part.done',
      item_id: reasoningItemId,
      output_index: reasoningIndex,
      summary_index: 0,
      part: { type: 'summary_text', text: reasoningText },
      sequence_number: seq++,
    };
    pending.push(partDone);
    const completedItem: ResponseReasoningItem = {
      id: reasoningItemId,
      type: 'reasoning',
      summary:
        reasoningText.length > 0
          ? [{ type: 'summary_text', text: reasoningText }]
          : [],
      status: 'completed',
      ...(reasoningSignature ? { encrypted_content: reasoningSignature } : {}),
    };
    const itemDone: ResponseOutputItemDoneEvent = {
      type: 'response.output_item.done',
      output_index: reasoningIndex,
      item: completedItem,
      sequence_number: seq++,
    };
    pending.push(itemDone);
    reasoningOpened = false;
    outputIndex++;
  };

  const openMessage = (): void => {
    if (messageOpened) return;
    messageItemId = `msg_${uuidv4()}`;
    messageOutputIndex = outputIndex;
    const item: ResponseOutputMessage = {
      id: messageItemId,
      type: 'message',
      role: 'assistant',
      status: 'in_progress',
      content: [],
    };
    const added: ResponseOutputItemAddedEvent = {
      type: 'response.output_item.added',
      output_index: outputIndex,
      item,
      sequence_number: seq++,
    };
    pending.push(added);
    const partAdded: ResponseContentPartAddedEvent = {
      type: 'response.content_part.added',
      item_id: messageItemId,
      output_index: outputIndex,
      content_index: 0,
      part: { type: 'output_text', text: '', annotations: [] },
      sequence_number: seq++,
    };
    pending.push(partAdded);
    messageOpened = true;
  };

  function closeMessage(): void {
    if (!messageOpened || !messageItemId || messageOutputIndex === undefined)
      return;
    const finalAnnotations = [...streamedAnnotations];
    const msgIndex = messageOutputIndex;
    const textDone: ResponseTextDoneEvent = {
      type: 'response.output_text.done',
      item_id: messageItemId,
      output_index: msgIndex,
      content_index: 0,
      text: textBuffer,
      logprobs: [],
      sequence_number: seq++,
    };
    pending.push(textDone);
    const partDone: ResponseContentPartDoneEvent = {
      type: 'response.content_part.done',
      item_id: messageItemId,
      output_index: msgIndex,
      content_index: 0,
      part: {
        type: 'output_text',
        text: textBuffer,
        annotations: finalAnnotations,
      },
      sequence_number: seq++,
    };
    pending.push(partDone);
    const completedItem: ResponseOutputMessage = {
      id: messageItemId,
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [
        {
          type: 'output_text',
          text: textBuffer,
          annotations: finalAnnotations,
        },
      ],
    };
    const itemDone: ResponseOutputItemDoneEvent = {
      type: 'response.output_item.done',
      output_index: msgIndex,
      item: completedItem,
      sequence_number: seq++,
    };
    pending.push(itemDone);
    messageOpened = false;
    if (msgIndex === outputIndex) outputIndex++;
  }

  const flushAnnotations = (): void => {
    if (!messageOpened || !messageItemId || messageOutputIndex === undefined) {
      return;
    }
    const fresh = groundingChunksToAnnotations(
      accumulator.grounding as Parameters<
        typeof groundingChunksToAnnotations
      >[0]
    );
    for (const annotation of fresh) {
      const key = annotationKey(annotation);
      if (emittedAnnotationKeys.has(key)) continue;
      emittedAnnotationKeys.add(key);
      const annotationIndex = streamedAnnotations.length;
      streamedAnnotations.push(annotation);
      const event: ResponseOutputTextAnnotationAddedEvent = {
        type: 'response.output_text.annotation.added',
        item_id: messageItemId,
        output_index: messageOutputIndex,
        content_index: 0,
        annotation_index: annotationIndex,
        annotation,
        sequence_number: seq++,
      };
      pending.push(event);
    }
  };

  for await (const chunk of source) {
    if (chunk.usageMetadata) accumulator.usage = chunk.usageMetadata;
    const candidate = chunk.candidates?.[0];
    if (candidate?.finishReason)
      accumulator.finishReason = candidate.finishReason;
    if (candidate?.groundingMetadata) {
      accumulator.grounding = candidate.groundingMetadata;
    }
    if (candidate?.urlContextMetadata) {
      accumulator.urlContext = candidate.urlContextMetadata;
    }

    for (const part of candidate?.content?.parts ?? []) {
      if (part.thought && typeof part.text === 'string') {
        // Reasoning has to land *before* the message item, so close any
        // open message first and surface the reasoning under a fresh
        // output_item. Once final-answer text starts streaming we close
        // the reasoning block (handled in the non-thought branch).
        if (messageOpened) closeMessage();
        openReasoning();
        if (
          part.text.length > 0 &&
          reasoningItemId &&
          reasoningIndex !== undefined
        ) {
          reasoningText += part.text;
          const delta: ResponseReasoningSummaryTextDeltaEvent = {
            type: 'response.reasoning_summary_text.delta',
            item_id: reasoningItemId,
            output_index: reasoningIndex,
            summary_index: 0,
            delta: part.text,
            sequence_number: seq++,
          };
          pending.push(delta);
        }
        if (part.thoughtSignature) reasoningSignature = part.thoughtSignature;
        continue;
      }
      if (typeof part.text === 'string' && part.text.length > 0) {
        if (reasoningOpened) closeReasoning();
        openMessage();
        textBuffer += part.text;
        if (messageItemId) {
          const textDelta: ResponseTextDeltaEvent = {
            type: 'response.output_text.delta',
            item_id: messageItemId,
            output_index: messageOutputIndex ?? outputIndex,
            content_index: 0,
            delta: part.text,
            logprobs: [],
            sequence_number: seq++,
          };
          pending.push(textDelta);
        }
      }
      if (part.functionCall?.name) {
        accumulator.hasFunctionCall = true;
        // Close any open reasoning + message items first (function calls
        // get their own output items).
        if (reasoningOpened) closeReasoning();
        if (messageOpened) closeMessage();
        const key = part.functionCall.id ?? `auto_${openFunctionCalls.size}`;
        if (!openFunctionCalls.has(key)) {
          const fcId = `fc_${uuidv4()}`;
          const fnIndex = outputIndex++;
          openFunctionCalls.set(key, {
            id: fcId,
            index: fnIndex,
            emittedArgs: '',
            name: part.functionCall.name,
          });
          const fnItem: ResponseFunctionToolCall = {
            id: fcId,
            type: 'function_call',
            call_id: key,
            name: part.functionCall.name,
            arguments: '',
            status: 'in_progress',
          };
          const fnAdded: ResponseOutputItemAddedEvent = {
            type: 'response.output_item.added',
            output_index: fnIndex,
            item: fnItem,
            sequence_number: seq++,
          };
          pending.push(fnAdded);
        }
        const state = openFunctionCalls.get(key);
        if (state) {
          const argsJson = JSON.stringify(part.functionCall.args ?? {});
          if (argsJson !== state.emittedArgs) {
            const delta = argsJson.slice(state.emittedArgs.length);
            state.emittedArgs = argsJson;
            const argsDelta: ResponseFunctionCallArgumentsDeltaEvent = {
              type: 'response.function_call_arguments.delta',
              item_id: state.id,
              output_index: state.index,
              delta,
              sequence_number: seq++,
            };
            pending.push(argsDelta);
          }
        }
      }
    }
    // Emit any newly-seen grounding citations after text deltas land
    // but before draining the chunk, so the annotation events arrive
    // adjacent to the text they reference.
    flushAnnotations();
    yield* drain();
  }

  if (reasoningOpened) closeReasoning();
  if (messageOpened) closeMessage();
  const completedFunctionCalls: ResponseFunctionToolCall[] = [];
  for (const [callKey, state] of openFunctionCalls) {
    const argsDone: ResponseFunctionCallArgumentsDoneEvent = {
      type: 'response.function_call_arguments.done',
      item_id: state.id,
      output_index: state.index,
      arguments: state.emittedArgs,
      name: state.name,
      sequence_number: seq++,
    };
    pending.push(argsDone);
    const completedFn: ResponseFunctionToolCall = {
      id: state.id,
      type: 'function_call',
      call_id: callKey,
      name: state.name,
      arguments: state.emittedArgs,
      status: 'completed',
    };
    completedFunctionCalls.push(completedFn);
    const fnDone: ResponseOutputItemDoneEvent = {
      type: 'response.output_item.done',
      output_index: state.index,
      item: completedFn,
      sequence_number: seq++,
    };
    pending.push(fnDone);
  }

  const finalResponse = makeFinalResponse({
    shell,
    accumulator,
    output: collectFinalOutput({
      completedFunctionCalls,
      textBuffer,
      messageItemId,
      annotations: streamedAnnotations,
      reasoning:
        reasoningItemId && (reasoningText.length > 0 || reasoningSignature)
          ? {
              id: reasoningItemId,
              text: reasoningText,
              encryptedContent: reasoningSignature,
            }
          : undefined,
    }),
  });
  const completedEvent: ResponseCompletedEvent = {
    type: 'response.completed',
    response: finalResponse,
    sequence_number: seq++,
  };
  pending.push(completedEvent);
  yield* drain();
}

function makeShellResponse(
  id: string,
  createdAt: number,
  model: string,
  request: ResponseCreateParams
): OpenAIResponse {
  const shell: OpenAIResponse = {
    id,
    object: 'response',
    created_at: createdAt,
    model,
    status: 'in_progress',
    output: [],
    output_text: '',
    incomplete_details: null,
    metadata: request.metadata ?? null,
    parallel_tool_calls: request.parallel_tool_calls ?? true,
    tool_choice: request.tool_choice ?? 'auto',
    tools: request.tools ?? [],
    temperature: request.temperature ?? null,
    top_p: request.top_p ?? null,
    max_output_tokens: request.max_output_tokens ?? null,
    instructions: request.instructions ?? null,
    previous_response_id: request.previous_response_id ?? null,
    reasoning: request.reasoning ?? null,
    text: request.text ?? undefined,
    truncation: request.truncation ?? null,
    error: null,
    user: request.user,
  };
  return shell;
}

function makeFinalResponse(args: {
  shell: OpenAIResponse;
  accumulator: StreamAccumulator;
  output: ResponseOutputItem[];
}): OpenAIResponse {
  const finish = mapFinishReason(
    args.accumulator.finishReason,
    args.accumulator.hasFunctionCall
  );
  const usage = mapUsageMetadata(args.accumulator.usage);
  const statusInfo = mapResponseStatus(finish.openai);
  const finalResponse: OpenAIResponse & {
    grounding_metadata?: unknown;
    vertex_ai_grounding_metadata?: unknown;
  } = {
    ...args.shell,
    status: statusInfo.status,
    output: args.output,
    output_text: joinOutputText(args.output),
    usage: usage.responses,
    incomplete_details: statusInfo.incompleteDetails,
  };
  // Streaming parity with the non-stream converter — surface the
  // grounding metadata accumulated across chunks on the
  // `response.completed` event's `response` object so playground /
  // SDK consumers see the same Gemini-native shape both modes.
  if (args.accumulator.grounding) {
    finalResponse.grounding_metadata = args.accumulator.grounding;
    finalResponse.vertex_ai_grounding_metadata = args.accumulator.grounding;
  }
  return finalResponse;
}

// ─── Provider class ───────────────────────────────────────────────

/**
 * Gemini's OpenAI-Responses input handler. Always routes through the
 * native `@google/genai` SDK via `GeminiDispatcher`.
 */
@Injectable()
export class GeminiResponseProvider {
  constructor(private readonly dispatcher: GeminiDispatcher) {}

  async handle(
    request: ResponseCreateParams,
    connection: AIConnectionEntity<GeminiConnectionConfig>,
    model: AIResourceModelConfigEntity,
    options?: CompletionRequestOptions
  ): Promise<OpenAIResponseResponse> {
    const params = requestResponsesToGemini(request);
    params.model = model.model;

    if (request.stream) {
      const native = await this.dispatcher.dispatchStream(
        params,
        connection,
        options
      );
      return {
        data: streamGeminiToResponses(native.data, model.model, request),
        headers: {},
        providerRequestPayload: native.providerRequestPayload,
      };
    }

    const native = await this.dispatcher.dispatch(params, connection, options);
    return {
      data: geminiResponseToResponses(native.data, model.model, request),
      headers: {},
      providerRequestPayload: native.providerRequestPayload,
    };
  }
}
