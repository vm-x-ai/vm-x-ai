import { HttpStatus } from '@nestjs/common';
import {
  GoogleGenAI,
  type Content,
  type GenerateContentResponse,
  type Tool,
} from '@google/genai';
import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionContentPart,
  ChatCompletionCreateParams,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/index.js';
import { v4 as uuidv4 } from 'uuid';
import { CompletionError } from '../../gateway/completion.types';
import {
  composeAbortSignal,
  type CompletionRequestOptions,
} from '../ai-provider.types';
import type { OpenAIConnectionConfig } from '../openai/shared';
import type { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';

/**
 * Hybrid bridge between the OpenAI Chat Completions request shape the
 * gateway speaks internally and Google's native @google/genai SDK.
 *
 * Used only when the request carries Gemini-only tool descriptors
 * (e.g. `tools: [{ googleSearch: {} }]`) that Google's OpenAI-compat
 * endpoint rejects. For everything else, the regular
 * `GeminiChatCompletionProvider` keeps using the OpenAI-compat
 * endpoint — that path is well-trodden and supports the bulk of
 * OpenAI features cleanly.
 *
 * Why this exists: the OpenAI-compat shim drops grounding metadata
 * silently (no `vertex_ai_grounding_metadata` in the response) and
 * 400s on `tools: [{ googleSearch: {} }]`. Downstream consumers need
 * the grounding chunks to render citations, so for that one feature
 * we have to talk to the native API.
 *
 * ─── Scope (T20) ───────────────────────────────────────────────────
 *
 * **The native path is intentionally narrow.** It exists to surface
 * `groundingMetadata` for the five Gemini-only tools listed in
 * `NATIVE_TOOL_KEYS`. It does NOT support:
 *
 *   - Multi-modal content parts (`image_url`, `input_audio`, `file`,
 *     `input_file`) — only `text` parts cross the boundary.
 *   - `tool` / `function` role messages (function-tool round-trips
 *     stay on the OpenAI-compat path).
 *   - `executableCode` / `codeExecutionResult` response parts.
 *   - `thoughtSignature` round-trip.
 *   - `thinkingConfig` from `reasoning_effort`.
 *   - `safetySettings` (only via `vmx.providerArgs` on the compat path).
 *   - `responseSchema` / `responseModalities` / `speechConfig` /
 *     `mediaResolution` / `videoMetadata`.
 *   - `safetyRatings` / `promptFeedback` / `finishReason` granularity
 *     in the response — the mapper hard-codes `'tool_calls'` or
 *     `'stop'` and drops the rest.
 *   - Per-modality usage breakdown.
 *
 * Callers that need any of the above should keep their request on the
 * OpenAI-compat path (i.e. avoid putting a `NATIVE_TOOL_KEY` in their
 * `tools[]` until expanded native parity is implemented). Expanding
 * native parity is a larger follow-up — when there's customer demand
 * for it, the native path needs (a) streaming, (b) multimodal Parts,
 * (c) `thinkingConfig` + `thoughtSignature` round-trip, (d) safety /
 * finishReason fidelity in the response mapper.
 */

/**
 * Tool keys recognised as native Gemini tools (not OpenAI function
 * tools). Detection is structural: if any tool object in the request
 * has one of these keys, the whole request must go through the native
 * SDK because the OpenAI-compat endpoint won't know what to do with
 * it.
 */
const NATIVE_TOOL_KEYS = [
  'googleSearch',
  'googleSearchRetrieval',
  'urlContext',
  'codeExecution',
  'fileSearch',
] as const;

/** True if the request needs the native @google/genai SDK path. */
export function needsNativeGeminiPath(
  request: ChatCompletionCreateParams
): boolean {
  // OpenAI's standard `web_search_options` is the portable opt-in for
  // grounding. Gemini's compat shim 400s on it, so we map it onto the
  // native path the same way we do for the explicit `googleSearch`
  // tool descriptor.
  if (request.web_search_options) return true;
  if (!request.tools?.length) return false;
  for (const tool of request.tools) {
    if (!tool || typeof tool !== 'object') continue;
    const t = tool as unknown as Record<string, unknown>;
    for (const key of NATIVE_TOOL_KEYS) {
      if (t[key] !== undefined) return true;
    }
  }
  return false;
}

/**
 * Convert OpenAI Chat Completion messages into Gemini `Content[]`.
 * System messages are returned separately so the caller can pass them
 * via `systemInstruction` on the request config (Gemini's system
 * channel) rather than as part of the conversation turns.
 */
function convertMessages(messages: ChatCompletionMessageParam[]): {
  contents: Content[];
  systemInstruction?: Content;
} {
  const contents: Content[] = [];
  const systemTexts: string[] = [];
  for (const msg of messages) {
    if (msg.role === 'system' || msg.role === 'developer') {
      if (typeof msg.content === 'string' && msg.content.length > 0) {
        systemTexts.push(msg.content);
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === 'text' && part.text) systemTexts.push(part.text);
        }
      }
      continue;
    }
    if (msg.role === 'user' || msg.role === 'assistant') {
      const role = msg.role === 'assistant' ? 'model' : 'user';
      const parts: Content['parts'] = [];
      if (typeof msg.content === 'string') {
        if (msg.content.length > 0) parts.push({ text: msg.content });
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content as ChatCompletionContentPart[]) {
          if (part.type === 'text') {
            parts.push({ text: part.text });
          }
          // image_url / file passthrough is intentionally not wired up
          // here — the native path is opt-in for googleSearch flows
          // today; multi-modal can extend this later.
        }
      }
      if (parts.length === 0) continue;
      contents.push({ role, parts });
    }
    // tool / function role messages are not surfaced on the native
    // path either — googleSearch flows don't round-trip user-defined
    // function calls.
  }
  return {
    contents,
    systemInstruction:
      systemTexts.length > 0
        ? { role: 'user', parts: [{ text: systemTexts.join('\n\n') }] }
        : undefined,
  };
}

/**
 * Convert the OpenAI-style `tools` array into Gemini's `Tool[]`. The
 * native-tool keys (googleSearch et al.) are passed through verbatim;
 * function tools are translated into `functionDeclarations` so a
 * single request can mix grounding with user-defined functions.
 */
function convertTools(
  tools: ChatCompletionTool[] | undefined
): Tool[] | undefined {
  if (!tools?.length) return undefined;
  const out: Tool[] = [];
  const functionDeclarations: NonNullable<Tool['functionDeclarations']> = [];
  for (const tool of tools) {
    const t = tool as unknown as Record<string, unknown>;
    const native: Record<string, unknown> = {};
    for (const key of NATIVE_TOOL_KEYS) {
      if (t[key] !== undefined) native[key] = t[key];
    }
    if (Object.keys(native).length > 0) {
      out.push(native as Tool);
      continue;
    }
    if (tool.type === 'function' && typeof tool.function?.name === 'string') {
      functionDeclarations.push({
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function
          .parameters as Tool['functionDeclarations'] extends
          | Array<infer F>
          | undefined
          ? F extends { parameters?: infer P }
            ? P
            : never
          : never,
      });
    }
  }
  if (functionDeclarations.length > 0) {
    out.push({ functionDeclarations });
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Build the final `Tool[]` sent to Gemini's native SDK from the
 * incoming OpenAI request. Equivalent to `convertTools(request.tools)`
 * but additionally injects `{ googleSearch: {} }` when the caller
 * supplied `web_search_options` and didn't already pin a Gemini-native
 * tool. Explicit tool lists stay authoritative — we only fill in the
 * portable opt-in.
 *
 * Exported for unit testing.
 */
export function buildNativeGeminiTools(
  request: ChatCompletionCreateParams
): Tool[] | undefined {
  const tools = convertTools(request.tools);
  if (!request.web_search_options) return tools;
  const hasNative = (tools ?? []).some((t) =>
    NATIVE_TOOL_KEYS.some(
      (key) => (t as unknown as Record<string, unknown>)[key] !== undefined
    )
  );
  if (hasNative) return tools;
  return [...(tools ?? []), { googleSearch: {} } as Tool];
}

/**
 * Map a non-streaming `GenerateContentResponse` to OpenAI
 * `ChatCompletion`. Grounding metadata is attached on the message
 * under `vertex_ai_grounding_metadata` so the assertion shape used by
 * downstream LiteLLM consumers (and by the integration test) finds
 * it.
 */
function mapResponseToChatCompletion(
  response: GenerateContentResponse,
  modelId: string
): ChatCompletion {
  const candidate = response.candidates?.[0];
  const text =
    candidate?.content?.parts
      ?.map((p) => (typeof p.text === 'string' ? p.text : ''))
      .join('') ?? '';
  const toolCalls: NonNullable<
    ChatCompletion['choices'][number]['message']['tool_calls']
  > = [];
  for (const part of candidate?.content?.parts ?? []) {
    const fc = (part as { functionCall?: { name?: string; args?: unknown } })
      .functionCall;
    if (fc?.name) {
      toolCalls.push({
        id: `call_${uuidv4()}`,
        type: 'function',
        function: {
          name: fc.name,
          arguments:
            typeof fc.args === 'string'
              ? fc.args
              : JSON.stringify(fc.args ?? {}),
        },
      });
    }
  }
  const usage = response.usageMetadata;
  const completion: ChatCompletion & {
    vertex_ai_grounding_metadata?: unknown;
  } = {
    id: response.responseId ?? `gemini-${uuidv4()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: modelId,
    choices: [
      {
        index: 0,
        logprobs: null,
        message: {
          role: 'assistant',
          content: text || null,
          refusal: null,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        },
        finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
      },
    ],
    usage: {
      prompt_tokens: usage?.promptTokenCount ?? 0,
      completion_tokens: usage?.candidatesTokenCount ?? 0,
      total_tokens:
        (usage?.promptTokenCount ?? 0) + (usage?.candidatesTokenCount ?? 0),
    },
  };
  // Surface grounding both at the top level (LiteLLM-compat) and on
  // the message object — different downstream consumers read it from
  // different places.
  const grounding = candidate?.groundingMetadata;
  if (grounding) {
    completion.vertex_ai_grounding_metadata = grounding;
    (
      completion.choices[0].message as unknown as Record<string, unknown>
    ).grounding_metadata = grounding;
  }
  return completion;
}

type NativeDispatchParams = {
  model: string;
  contents: Content[];
  config: Record<string, unknown>;
};

/**
 * Build the request body shared by streaming and non-streaming
 * dispatch and validate the connection has an API key. Throws the
 * appropriate `CompletionError` if config is missing.
 */
function buildNativeRequest(
  request: ChatCompletionCreateParams,
  connection: AIConnectionEntity<OpenAIConnectionConfig>,
  modelId: string,
  options?: CompletionRequestOptions
): { ai: GoogleGenAI; params: NativeDispatchParams } {
  if (!connection.config?.apiKey) {
    throw new CompletionError({
      message: 'Gemini API key missing on connection',
      rate: false,
      retryable: false,
      statusCode: HttpStatus.BAD_REQUEST,
      failureReason: 'Connection config invalid',
      openAICompatibleError: { code: 'invalid_api_key' },
    });
  }
  const ai = new GoogleGenAI({ apiKey: connection.config.apiKey });
  const { contents, systemInstruction } = convertMessages(request.messages);
  const tools = buildNativeGeminiTools(request);

  const config: Record<string, unknown> = {};
  if (systemInstruction) config.systemInstruction = systemInstruction;
  if (tools) config.tools = tools;
  if (request.max_tokens != null) config.maxOutputTokens = request.max_tokens;
  if (request.max_completion_tokens != null) {
    config.maxOutputTokens = request.max_completion_tokens;
  }
  if (request.temperature != null) config.temperature = request.temperature;
  if (request.top_p != null) config.topP = request.top_p;
  // Google GenAI SDK only exposes `abortSignal` — no first-class
  // per-request `timeout`. Synthesize one from `options.timeoutMs`
  // and union with the controller's disconnect signal.
  const composedSignal = composeAbortSignal(options);
  if (composedSignal) config.abortSignal = composedSignal;

  return { ai, params: { model: modelId, contents, config } };
}

function wrapNativeError(
  error: unknown,
  params: NativeDispatchParams
): CompletionError {
  const err = error as Error & { status?: number; statusCode?: number };
  const statusCode =
    err.status ?? err.statusCode ?? HttpStatus.INTERNAL_SERVER_ERROR;
  return new CompletionError(
    {
      rate: statusCode === 429,
      message: err.message ?? 'Gemini native request failed',
      statusCode,
      retryable: [500, 502, 503, 504].includes(statusCode),
      failureReason: 'External API error',
      openAICompatibleError: { code: 'gemini_native_error' },
      providerRequestPayload: params as unknown as Record<string, unknown>,
    },
    err
  );
}

/**
 * Run a non-streaming Gemini request through the native
 * @google/genai SDK and return an OpenAI ChatCompletion shape so
 * callers downstream of the gateway don't need to know which path was
 * taken.
 */
export async function dispatchNativeGemini(
  request: ChatCompletionCreateParams,
  connection: AIConnectionEntity<OpenAIConnectionConfig>,
  modelId: string,
  options?: CompletionRequestOptions
): Promise<{
  data: ChatCompletion;
  providerRequestPayload: Record<string, unknown>;
}> {
  const { ai, params } = buildNativeRequest(
    request,
    connection,
    modelId,
    options
  );
  try {
    const response = await ai.models.generateContent(params);
    return {
      data: mapResponseToChatCompletion(response, modelId),
      providerRequestPayload: params as unknown as Record<string, unknown>,
    };
  } catch (error) {
    throw wrapNativeError(error, params);
  }
}

/**
 * Streaming variant. Translates Gemini's native `generateContentStream`
 * output into a sequence of OpenAI `ChatCompletionChunk`s so the rest
 * of the gateway can treat it like any other streaming Chat Completion
 * response. Grounding metadata is attached to the closing chunk under
 * `vertex_ai_grounding_metadata` (matching the non-streaming path) so
 * downstream consumers reading citations don't need a special branch.
 *
 * Function-tool deltas during streaming are intentionally not emitted —
 * the native path is opt-in for grounding flows where user-defined
 * function tools don't round-trip anyway. Multi-modal content parts
 * remain text-only as well.
 */
export async function dispatchNativeGeminiStream(
  request: ChatCompletionCreateParams,
  connection: AIConnectionEntity<OpenAIConnectionConfig>,
  modelId: string,
  options?: CompletionRequestOptions
): Promise<{
  data: AsyncIterable<ChatCompletionChunk>;
  providerRequestPayload: Record<string, unknown>;
}> {
  const { ai, params } = buildNativeRequest(
    request,
    connection,
    modelId,
    options
  );
  // Kick the request off eagerly so transport / auth errors surface
  // here (mappable to a `CompletionError`) instead of from inside the
  // async iterator the gateway is about to forward.
  let stream: AsyncIterable<GenerateContentResponse>;
  try {
    stream = await ai.models.generateContentStream(params);
  } catch (error) {
    throw wrapNativeError(error, params);
  }
  return {
    data: nativeChunksToOpenAI(stream, modelId),
    providerRequestPayload: params as unknown as Record<string, unknown>,
  };
}

async function* nativeChunksToOpenAI(
  stream: AsyncIterable<GenerateContentResponse>,
  modelId: string
): AsyncIterable<ChatCompletionChunk> {
  const id = `gemini-${uuidv4()}`;
  const created = Math.floor(Date.now() / 1000);
  let lastUsage: GenerateContentResponse['usageMetadata'] | undefined;
  let lastGrounding: unknown;
  let emittedRole = false;

  for await (const part of stream) {
    if (!emittedRole) {
      emittedRole = true;
      yield {
        id,
        object: 'chat.completion.chunk',
        created,
        model: modelId,
        choices: [
          { index: 0, delta: { role: 'assistant' }, finish_reason: null },
        ],
      } as ChatCompletionChunk;
    }
    const candidate = part.candidates?.[0];
    const text =
      candidate?.content?.parts
        ?.map((p) => (typeof p.text === 'string' ? p.text : ''))
        .join('') ?? '';
    if (text.length > 0) {
      yield {
        id,
        object: 'chat.completion.chunk',
        created,
        model: modelId,
        choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
      } as ChatCompletionChunk;
    }
    if (part.usageMetadata) lastUsage = part.usageMetadata;
    if (candidate?.groundingMetadata)
      lastGrounding = candidate.groundingMetadata;
  }

  // Closing chunk: finish_reason + usage + (optional) grounding.
  // Stream consumers detect the last chunk via `choices[0].finish_reason`,
  // matching the OpenAI Chat Completions contract.
  const closing: ChatCompletionChunk & {
    vertex_ai_grounding_metadata?: unknown;
  } = {
    id,
    object: 'chat.completion.chunk',
    created,
    model: modelId,
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    usage: lastUsage
      ? {
          prompt_tokens: lastUsage.promptTokenCount ?? 0,
          completion_tokens: lastUsage.candidatesTokenCount ?? 0,
          total_tokens:
            (lastUsage.promptTokenCount ?? 0) +
            (lastUsage.candidatesTokenCount ?? 0),
        }
      : undefined,
  };
  if (lastGrounding) closing.vertex_ai_grounding_metadata = lastGrounding;
  yield closing;
}
