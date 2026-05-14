import { Injectable } from '@nestjs/common';
import type {
  ChatCompletion,
  ChatCompletionAssistantMessageParam,
  ChatCompletionChunk,
  ChatCompletionContentPart,
  ChatCompletionCreateParams,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionTool,
  ChatCompletionToolMessageParam,
  ChatCompletionUserMessageParam,
} from 'openai/resources/index.js';
import {
  type Content,
  type FunctionDeclaration,
  type GenerateContentConfig,
  type GenerateContentParameters,
  type GenerateContentResponse,
  type Part,
  type Tool,
  type ToolConfig,
} from '@google/genai';
import { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import {
  CompletionRequestOptions,
  OpenAICompletionResponse,
} from '../ai-provider.types';
import { stripPassthroughEnvelope } from '../passthrough.helpers';
import {
  GeminiDispatcher,
  type GeminiConnectionConfig,
  type StreamAccumulator,
  applyGeminiProviderArgs,
  coerceJsonSchema,
  geminiResponseId,
  makeFunctionCallingConfig,
  mapFinishReason,
  mapReasoningEffortToThinking,
  mapUsageMetadata,
  newStreamAccumulator,
  parseDataUrl,
  parseToolCallArguments,
  urlToMediaPart,
} from './shared';

/**
 * Gemini's OpenAI-Chat-Completions input handler.
 *
 * Converts the OpenAI body into Gemini's native `GenerateContentParameters`
 * (no more OpenAI-compat endpoint passthrough) and surfaces the native
 * response back as a `ChatCompletion` — preserving features the compat
 * shim used to drop on the floor: `thoughtSignature`, grounding metadata,
 * executableCode / codeExecutionResult parts, per-modality usage,
 * fine-grained finishReason, `responseJsonSchema`.
 *
 * Native-only request features (`tools: [{ googleSearch: {} }]`,
 * `urlContext`, `codeExecution`, `fileSearch`, `web_search_options`)
 * just pass through — the converter doesn't gate them.
 */

// ───────────────────────────────────────────────────────────────────────
// Constants
// ───────────────────────────────────────────────────────────────────────

/**
 * Native-tool keys recognised on the OpenAI `tools[]` array. When any
 * tool object carries one of these, we forward the descriptor verbatim
 * onto Gemini's `Tool[]` rather than translating to a function
 * declaration.
 */
const NATIVE_TOOL_KEYS = [
  'googleSearch',
  'googleSearchRetrieval',
  'urlContext',
  'codeExecution',
  'fileSearch',
  'googleMaps',
  'computerUse',
  'enterpriseWebSearch',
] as const;

// ───────────────────────────────────────────────────────────────────────
// OpenAI Chat Completions → Gemini native
// ───────────────────────────────────────────────────────────────────────

export type OpenAIToGeminiOptions = {
  /** Default `maxOutputTokens` when the request omits one. */
  defaultMaxTokens?: number;
};

/**
 * Convert an OpenAI Chat Completions request into Gemini's native
 * `GenerateContentParameters`. The model name is taken from
 * `request.model`; callers (the provider class) override with the
 * resolved upstream model id before dispatch.
 */
export function openAIRequestToGemini(
  request: ChatCompletionCreateParams,
  options: OpenAIToGeminiOptions = {}
): GenerateContentParameters {
  const sanitised = stripPassthroughEnvelope(request);

  const { contents, systemInstruction } = openAIMessagesToGemini(
    sanitised.messages
  );
  const config: GenerateContentConfig = {};
  if (systemInstruction) config.systemInstruction = systemInstruction;

  const tools = openAIToolsToGemini(sanitised);
  if (tools && tools.length > 0) config.tools = tools;

  const toolConfig = openAIToolChoiceToGemini(sanitised);
  if (toolConfig) config.toolConfig = toolConfig;

  const maxTokens =
    sanitised.max_completion_tokens ??
    sanitised.max_tokens ??
    options.defaultMaxTokens;
  if (maxTokens != null) config.maxOutputTokens = maxTokens;
  if (sanitised.temperature != null) config.temperature = sanitised.temperature;
  if (sanitised.top_p != null) config.topP = sanitised.top_p;
  if (sanitised.frequency_penalty != null) {
    config.frequencyPenalty = sanitised.frequency_penalty;
  }
  if (sanitised.presence_penalty != null) {
    config.presencePenalty = sanitised.presence_penalty;
  }
  if (sanitised.seed != null) config.seed = sanitised.seed;
  if (sanitised.stop) {
    const stops = (
      Array.isArray(sanitised.stop) ? sanitised.stop : [sanitised.stop]
    ).filter((s): s is string => typeof s === 'string' && s.length > 0);
    if (stops.length > 0) config.stopSequences = stops;
  }
  if (sanitised.logprobs) config.responseLogprobs = sanitised.logprobs;
  if (sanitised.top_logprobs != null) config.logprobs = sanitised.top_logprobs;

  applyResponseFormat(config, sanitised);

  const thinking = mapReasoningEffortToThinking(
    sanitised.reasoning_effort,
    maxTokens
  );
  if (thinking) config.thinkingConfig = thinking;

  // Caller-supplied Gemini-only knobs ride along on `vmx.providerArgs`
  // (the gateway-level escape hatch). Strict OpenAI clients can still
  // wire safety / responseModalities / mediaResolution / speechConfig
  // without us having to model each in the converter signature.
  applyGeminiProviderArgs(config, request);

  return { model: sanitised.model, contents, config };
}

function openAIMessagesToGemini(messages: ChatCompletionMessageParam[]): {
  contents: Content[];
  systemInstruction?: Content;
} {
  const contents: Content[] = [];
  const systemTexts: string[] = [];
  // Pending function responses get coalesced into the next `user`
  // turn — Gemini expects `functionResponse` parts alongside text in
  // a single content block, not as separate role messages.
  let pendingToolResponses: Part[] = [];

  // Gemini's `functionResponse.name` must match the prior `functionCall.name`
  // — `tool_call_id` alone (which is all the OpenAI tool message carries)
  // is not enough. Walk the message list once to build the id→name index
  // so each tool response can re-attach its function name.
  const toolCallNameById = new Map<string, string>();
  for (const msg of messages) {
    if (msg.role !== 'assistant' || !msg.tool_calls) continue;
    for (const tc of msg.tool_calls) {
      if (tc.type === 'function') toolCallNameById.set(tc.id, tc.function.name);
    }
  }

  const flushPendingTools = () => {
    if (pendingToolResponses.length === 0) return;
    contents.push({ role: 'user', parts: pendingToolResponses });
    pendingToolResponses = [];
  };

  for (const msg of messages) {
    if (msg.role === 'system' || msg.role === 'developer') {
      systemTexts.push(...extractTextContent(msg.content));
      continue;
    }
    if (msg.role === 'tool') {
      pendingToolResponses.push(
        toolMessageToFunctionResponsePart(msg, toolCallNameById)
      );
      continue;
    }
    flushPendingTools();
    if (msg.role === 'user') {
      const parts = userMessageToGeminiParts(msg);
      if (parts.length > 0) contents.push({ role: 'user', parts });
    } else if (msg.role === 'assistant') {
      const parts = assistantMessageToGeminiParts(msg);
      if (parts.length > 0) contents.push({ role: 'model', parts });
    }
    // function/role aliases are deprecated — modern OpenAI clients
    // emit tool messages; ignore anything else rather than throwing.
  }
  flushPendingTools();

  const systemInstruction: Content | undefined =
    systemTexts.length > 0
      ? { role: 'user', parts: [{ text: systemTexts.join('\n\n') }] }
      : undefined;
  return { contents, systemInstruction };
}

function extractTextContent(
  content: ChatCompletionMessageParam['content']
): string[] {
  if (typeof content === 'string') {
    return content.length > 0 ? [content] : [];
  }
  if (!Array.isArray(content)) return [];
  const out: string[] = [];
  for (const part of content) {
    if (part.type === 'text' && part.text) out.push(part.text);
  }
  return out;
}

function userMessageToGeminiParts(msg: ChatCompletionUserMessageParam): Part[] {
  if (typeof msg.content === 'string') {
    return msg.content.length > 0 ? [{ text: msg.content }] : [];
  }
  const parts: Part[] = [];
  for (const part of msg.content) {
    pushContentPartAsGeminiPart(parts, part);
  }
  return parts;
}

function pushContentPartAsGeminiPart(
  out: Part[],
  part: ChatCompletionContentPart
): void {
  if (part.type === 'text') {
    if (part.text.length > 0) out.push({ text: part.text });
    return;
  }
  if (part.type === 'image_url') {
    // External URL — Gemini accepts `fileData` for HTTPS URLs the
    // model can fetch (e.g. Google Cloud Storage). Best-effort
    // forward; the upstream returns a 400 for unsupported origins.
    out.push(urlToMediaPart(part.image_url.url, 'image/*'));
    return;
  }
  if ((part as { type?: string }).type === 'file') {
    const filePart = part as {
      type: 'file';
      file: { file_data?: string; file_id?: string; filename?: string };
    };
    const parsed = parseDataUrl(filePart.file?.file_data ?? '');
    if (parsed) {
      out.push({
        inlineData: { mimeType: parsed.mimeType, data: parsed.data },
      });
    } else if (filePart.file?.file_id) {
      // Gemini's File API uses `fileData.fileUri` of the form
      // `files/<name>`; surface the id verbatim and let the upstream
      // resolve.
      out.push({
        fileData: {
          fileUri: filePart.file.file_id,
          mimeType: 'application/octet-stream',
        },
      });
    }
    return;
  }
  if ((part as { type?: string }).type === 'input_audio') {
    const audioPart = part as {
      input_audio: { data?: string; format?: string };
    };
    if (audioPart.input_audio?.data) {
      const mimeType = audioPart.input_audio.format
        ? `audio/${audioPart.input_audio.format}`
        : 'audio/mp3';
      out.push({
        inlineData: { mimeType, data: audioPart.input_audio.data },
      });
    }
  }
}

function assistantMessageToGeminiParts(
  msg: ChatCompletionAssistantMessageParam
): Part[] {
  const parts: Part[] = [];
  if (typeof msg.content === 'string' && msg.content.length > 0) {
    parts.push({ text: msg.content });
  } else if (Array.isArray(msg.content)) {
    for (const part of msg.content) {
      if (part.type === 'text' && part.text.length > 0) {
        parts.push({ text: part.text });
        continue;
      }
      // OpenAI also allows `refusal` content parts on an assistant
      // turn — surface as plain text so Gemini sees the prior refusal
      // when replaying the conversation. The top-level `refusal` field
      // (string | null on the message itself) gets the same treatment
      // just below.
      if (
        (part as { type?: string }).type === 'refusal' &&
        typeof (part as { refusal?: string }).refusal === 'string' &&
        (part as { refusal: string }).refusal.length > 0
      ) {
        parts.push({ text: (part as { refusal: string }).refusal });
      }
    }
  }
  const refusalText = (msg as { refusal?: string | null }).refusal;
  if (typeof refusalText === 'string' && refusalText.length > 0) {
    parts.push({ text: refusalText });
  }
  // Replay prior reasoning so multi-turn thinking-mode continuity
  // works on the next turn. The signed thought parts come back from
  // a previous response via the OpenAI extension we added in the
  // anthropic provider; Gemini round-trips them under `thought` +
  // `thoughtSignature`.
  const reasoning = (
    msg as ChatCompletionAssistantMessageParam & {
      reasoning?: {
        thinking?: string;
        signature?: string;
        redacted?: string[];
      };
    }
  ).reasoning;
  if (reasoning?.thinking) {
    parts.push({
      text: reasoning.thinking,
      thought: true,
      ...(reasoning.signature ? { thoughtSignature: reasoning.signature } : {}),
    });
  }
  for (const tc of msg.tool_calls ?? []) {
    if (tc.type !== 'function') continue;
    parts.push({
      functionCall: {
        id: tc.id,
        name: tc.function.name,
        args: parseToolCallArguments(tc.function.arguments),
      },
    });
  }
  return parts;
}

function toolMessageToFunctionResponsePart(
  msg: ChatCompletionToolMessageParam,
  toolCallNameById: Map<string, string>
): Part {
  // OpenAI's `ChatCompletionToolMessageParam.content` is text-only
  // (`string | Array<ChatCompletionContentPartText>`), so there's no
  // multimodal payload to lift into `functionResponse.parts` — the
  // joined text goes straight into `response.output`. The Anthropic
  // and Responses providers do split into `parts` because their tool
  // results / function_call_outputs can carry images and files.
  const content =
    typeof msg.content === 'string'
      ? msg.content
      : (msg.content ?? [])
          .map((c) => (c.type === 'text' ? c.text : ''))
          .filter(Boolean)
          .join('\n');
  // Gemini's `functionResponse.name` must match the prior `functionCall.name`
  // for the model to correlate the response with the original call. Fall back
  // to `tool_call_id` only when we can't find the matching assistant turn —
  // better to send something than to drop the part entirely.
  const name = toolCallNameById.get(msg.tool_call_id) ?? msg.tool_call_id;
  return {
    functionResponse: {
      id: msg.tool_call_id,
      name,
      response: { output: content },
    },
  };
}

function openAIToolsToGemini(
  request: ChatCompletionCreateParams
): Tool[] | undefined {
  const tools: Tool[] = [];
  const functionDeclarations: FunctionDeclaration[] = [];

  for (const tool of request.tools ?? []) {
    if (!tool || typeof tool !== 'object') continue;
    const nativeDescriptor = extractNativeToolDescriptor(tool);
    if (nativeDescriptor) {
      tools.push(nativeDescriptor);
      continue;
    }
    if (tool.type === 'function' && typeof tool.function?.name === 'string') {
      functionDeclarations.push({
        name: tool.function.name,
        description: tool.function.description,
        parametersJsonSchema: coerceJsonSchema(tool.function.parameters),
      });
    }
  }
  // Deprecated `functions` array (legacy OpenAI shape).
  for (const fn of request.functions ?? []) {
    if (!fn.name) continue;
    functionDeclarations.push({
      name: fn.name,
      description: fn.description,
      parametersJsonSchema: coerceJsonSchema(fn.parameters),
    });
  }
  // `web_search_options` is OpenAI's portable opt-in for grounding —
  // map onto `googleSearch` when the caller didn't already pin a
  // native search tool.
  //
  // `web_search_options` carries `search_context_size` (low/medium/high)
  // and `user_location`; neither has a Gemini-API equivalent on
  // `GoogleSearch`, so both fields are silently dropped. Callers
  // needing native Gemini knobs (`timeRangeFilter`, etc.) can bypass
  // this converter via `vmx.providerArgs.tools` — full replace.
  if (
    request.web_search_options &&
    !tools.some(
      (t) => t.googleSearch != null || t.googleSearchRetrieval != null
    )
  ) {
    tools.push({ googleSearch: {} });
  }
  if (functionDeclarations.length > 0) {
    tools.push({ functionDeclarations });
  }
  return tools.length > 0 ? tools : undefined;
}

function extractNativeToolDescriptor(
  tool: ChatCompletionTool | Record<string, unknown>
): Tool | undefined {
  const t = tool as Record<string, unknown>;
  const native: Record<string, unknown> = {};
  for (const key of NATIVE_TOOL_KEYS) {
    if (t[key] !== undefined) native[key] = t[key];
  }
  if (Object.keys(native).length === 0) return undefined;
  return native as Tool;
}

function openAIToolChoiceToGemini(
  request: ChatCompletionCreateParams
): ToolConfig | undefined {
  const choice = request.tool_choice;
  if (choice == null) return undefined;
  if (choice === 'auto') return makeFunctionCallingConfig('auto');
  if (choice === 'required') return makeFunctionCallingConfig('any');
  if (choice === 'none') return makeFunctionCallingConfig('none');
  if (typeof choice === 'object' && choice.type === 'function') {
    return makeFunctionCallingConfig('named', choice.function.name);
  }
  return undefined;
}

function applyResponseFormat(
  config: GenerateContentConfig,
  request: ChatCompletionCreateParams
): void {
  const responseFormat = (
    request as ChatCompletionCreateParams & {
      response_format?: {
        type?: string;
        json_schema?: {
          name?: string;
          description?: string;
          schema?: Record<string, unknown>;
        };
      };
    }
  ).response_format;
  if (!responseFormat) return;
  if (responseFormat.type === 'json_object') {
    config.responseMimeType = 'application/json';
    return;
  }
  if (
    responseFormat.type === 'json_schema' &&
    responseFormat.json_schema?.schema
  ) {
    config.responseMimeType = 'application/json';
    config.responseJsonSchema = coerceJsonSchema(
      responseFormat.json_schema.schema
    );
  }
}

// ───────────────────────────────────────────────────────────────────────
// Gemini native → OpenAI Chat Completion (response body)
// ───────────────────────────────────────────────────────────────────────

/**
 * Map a non-streaming `GenerateContentResponse` to an OpenAI
 * `ChatCompletion`. Surfaces Gemini-only artefacts the OpenAI shape
 * has no native slot for:
 *
 *   - `groundingMetadata` → `vertex_ai_grounding_metadata` (top-level
 *     and on the message) so downstream consumers can render
 *     citations. Mirrors the LiteLLM Gateway behaviour.
 *   - `urlContextMetadata` → `url_context_metadata` (message extension).
 *   - `executableCode` / `codeExecutionResult` parts → synthetic
 *     `tool_calls` with `name: 'code_execution'` so the OpenAI client
 *     sees them; the raw parts are also preserved on the message via
 *     `gemini_code_execution`.
 *   - `thoughtSignature` round-trip → `message.reasoning.signature`.
 *   - Per-modality usage breakdown → `usage.prompt_tokens_details`
 *     and `completion_tokens_details`.
 *   - `safetyRatings` / `finishMessage` / `promptFeedback` →
 *     `gemini_safety` extension on the choice.
 */
export function geminiResponseToOpenAIChat(
  response: GenerateContentResponse,
  model: string
): ChatCompletion {
  const candidate = response.candidates?.[0];
  let text = '';
  let thinkingText = '';
  let thoughtSignature: string | undefined;
  const toolCalls: ChatCompletionMessageToolCall[] = [];
  const codeExecutionBlocks: Array<{
    executable?: { language?: string; code?: string };
    result?: { outcome?: string; output?: string };
  }> = [];
  let hasFunctionCall = false;

  for (const part of candidate?.content?.parts ?? []) {
    if (part.thought && typeof part.text === 'string') {
      thinkingText += part.text;
      if (part.thoughtSignature) thoughtSignature = part.thoughtSignature;
      continue;
    }
    if (typeof part.text === 'string') text += part.text;
    if (part.functionCall?.name) {
      hasFunctionCall = true;
      toolCalls.push({
        id:
          part.functionCall.id ??
          `call_${candidate?.index ?? 0}_${toolCalls.length}`,
        type: 'function',
        function: {
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args ?? {}),
        },
      });
    }
    if (part.executableCode) {
      codeExecutionBlocks.push({ executable: part.executableCode });
    }
    if (part.codeExecutionResult) {
      codeExecutionBlocks.push({ result: part.codeExecutionResult });
    }
  }

  // Prompt-level safety blocks come back with `promptFeedback.blockReason`
  // and no candidate. The candidate-level `mapFinishReason` would default
  // to `'stop'` in that case; promote to `'content_filter'` so the OpenAI
  // client can route it to its refusal path.
  const promptBlockReason = (
    response.promptFeedback as
      | { blockReason?: string; blockReasonMessage?: string }
      | undefined
  )?.blockReason;
  const promptBlocked = !candidate && Boolean(promptBlockReason);
  const finish = promptBlocked
    ? { openai: 'content_filter' as const, anthropic: 'refusal' as const }
    : mapFinishReason(candidate?.finishReason, hasFunctionCall);
  const usage = mapUsageMetadata(response.usageMetadata);

  const message: ChatCompletion['choices'][number]['message'] & {
    reasoning?: { thinking?: string; signature?: string };
    grounding_metadata?: unknown;
    url_context_metadata?: unknown;
    gemini_code_execution?: typeof codeExecutionBlocks;
    gemini_safety?: {
      ratings?: unknown;
      finishMessage?: string;
    };
  } = {
    role: 'assistant',
    content: text.length > 0 ? text : null,
    refusal:
      finish.openai === 'content_filter'
        ? candidate?.finishMessage ??
          (
            response.promptFeedback as
              | { blockReasonMessage?: string }
              | undefined
          )?.blockReasonMessage ??
          promptBlockReason ??
          null
        : null,
    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
  };
  if (thinkingText.length > 0 || thoughtSignature) {
    message.reasoning = {
      thinking: thinkingText.length > 0 ? thinkingText : undefined,
      signature: thoughtSignature,
    };
  }
  if (candidate?.groundingMetadata) {
    message.grounding_metadata = candidate.groundingMetadata;
  }
  if (candidate?.urlContextMetadata) {
    message.url_context_metadata = candidate.urlContextMetadata;
  }
  if (codeExecutionBlocks.length > 0) {
    message.gemini_code_execution = codeExecutionBlocks;
  }
  if (candidate && (candidate.safetyRatings || candidate.finishMessage)) {
    message.gemini_safety = {
      ratings: candidate.safetyRatings,
      finishMessage: candidate.finishMessage,
    };
  }

  const completion: ChatCompletion & {
    vertex_ai_grounding_metadata?: unknown;
    prompt_feedback?: unknown;
  } = {
    id: geminiResponseId(response, 'gemini'),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        logprobs: null,
        message,
        finish_reason: finish.openai,
      },
    ],
    usage: {
      prompt_tokens: usage.openai.prompt_tokens,
      completion_tokens: usage.openai.completion_tokens,
      total_tokens: usage.openai.total_tokens,
      prompt_tokens_details: usage.openai.prompt_tokens_details,
      completion_tokens_details: usage.openai.completion_tokens_details,
    },
  };
  if (candidate?.groundingMetadata) {
    completion.vertex_ai_grounding_metadata = candidate.groundingMetadata;
  }
  if (response.promptFeedback) {
    completion.prompt_feedback = response.promptFeedback;
  }
  return completion;
}

// ───────────────────────────────────────────────────────────────────────
// Gemini native stream → OpenAI Chat Completion chunks
// ───────────────────────────────────────────────────────────────────────

export async function* geminiStreamToOpenAIChatChunks(
  source: AsyncIterable<GenerateContentResponse>,
  model: string,
  responseId: string
): AsyncIterable<ChatCompletionChunk> {
  const created = Math.floor(Date.now() / 1000);
  let roleEmitted = false;
  const accumulator: StreamAccumulator = newStreamAccumulator();
  // Per-call tool index, since Gemini emits each functionCall part
  // as a complete object — no streaming arg deltas — so we surface
  // one tool_calls chunk per call with its full arguments.
  let nextToolIndex = 0;

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

    if (!roleEmitted) {
      roleEmitted = true;
      yield {
        id: responseId,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [
          { index: 0, delta: { role: 'assistant' }, finish_reason: null },
        ],
      };
    }

    let textBuf = '';
    let reasoningBuf = '';
    let reasoningSig: string | undefined;

    for (const part of candidate?.content?.parts ?? []) {
      if (part.thought && typeof part.text === 'string') {
        reasoningBuf += part.text;
        if (part.thoughtSignature) reasoningSig = part.thoughtSignature;
        continue;
      }
      if (typeof part.text === 'string') textBuf += part.text;
      if (part.functionCall?.name) {
        accumulator.hasFunctionCall = true;
        const toolIndex = nextToolIndex++;
        yield {
          id: responseId,
          object: 'chat.completion.chunk',
          created,
          model,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: toolIndex,
                    id: part.functionCall.id ?? `call_${toolIndex}`,
                    type: 'function',
                    function: {
                      name: part.functionCall.name,
                      arguments: JSON.stringify(part.functionCall.args ?? {}),
                    },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        };
      }
    }

    if (textBuf.length > 0) {
      yield {
        id: responseId,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [
          { index: 0, delta: { content: textBuf }, finish_reason: null },
        ],
      };
    }
    if (reasoningBuf.length > 0 || reasoningSig) {
      yield {
        id: responseId,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [
          {
            index: 0,
            delta: {
              reasoning: {
                thinking: reasoningBuf || undefined,
                signature: reasoningSig,
              },
            } as ChatCompletionChunk.Choice['delta'],
            finish_reason: null,
          },
        ],
      };
    }
  }

  const finish = mapFinishReason(
    accumulator.finishReason,
    accumulator.hasFunctionCall
  );
  const usage = mapUsageMetadata(accumulator.usage);

  type ClosingChunk = ChatCompletionChunk & {
    vertex_ai_grounding_metadata?: unknown;
    url_context_metadata?: unknown;
  };
  const closing: ClosingChunk = {
    id: responseId,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [{ index: 0, delta: {}, finish_reason: finish.openai }],
    usage: {
      prompt_tokens: usage.openai.prompt_tokens,
      completion_tokens: usage.openai.completion_tokens,
      total_tokens: usage.openai.total_tokens,
      prompt_tokens_details: usage.openai.prompt_tokens_details,
      completion_tokens_details: usage.openai.completion_tokens_details,
    },
  };
  if (accumulator.grounding) {
    closing.vertex_ai_grounding_metadata = accumulator.grounding;
  }
  if (accumulator.urlContext) {
    closing.url_context_metadata = accumulator.urlContext;
  }
  yield closing;
}

// ───────────────────────────────────────────────────────────────────────
// Provider class
// ───────────────────────────────────────────────────────────────────────

/**
 * Gemini's OpenAI-Chat-Completions input handler.
 *
 * Always routes through the native `@google/genai` SDK via
 * `GeminiDispatcher` — the OpenAI-compat endpoint is no longer used.
 */
@Injectable()
export class GeminiChatCompletionProvider {
  constructor(private readonly dispatcher: GeminiDispatcher) {}

  async handle(
    request: ChatCompletionCreateParams,
    connection: AIConnectionEntity<GeminiConnectionConfig>,
    model: AIResourceModelConfigEntity,
    options?: CompletionRequestOptions
  ): Promise<OpenAICompletionResponse> {
    const params = openAIRequestToGemini(request);
    params.model = model.model;

    if (request.stream) {
      const native = await this.dispatcher.dispatchStream(
        params,
        connection,
        options
      );
      const responseId = `chatcmpl-${Date.now()}`;
      return {
        data: geminiStreamToOpenAIChatChunks(
          native.data,
          model.model,
          responseId
        ),
        headers: {},
        providerRequestPayload: native.providerRequestPayload,
      };
    }

    const native = await this.dispatcher.dispatch(params, connection, options);
    return {
      data: geminiResponseToOpenAIChat(native.data, model.model),
      headers: {},
      providerRequestPayload: native.providerRequestPayload,
    };
  }
}
