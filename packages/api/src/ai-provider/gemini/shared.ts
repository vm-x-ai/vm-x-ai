import { HttpStatus, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import {
  FunctionCallingConfigMode,
  GoogleGenAI,
  FinishReason as GeminiFinishReason,
  type FunctionResponsePart,
  type GenerateContentConfig,
  type GenerateContentParameters,
  type GenerateContentResponse,
  type Part,
  type ThinkingConfig,
  type ToolConfig,
  type UsageMetadata,
} from '@google/genai';
import { v4 as uuidv4 } from 'uuid';
import type { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import { CompletionError } from '../../gateway/completion.types';
import {
  composeAbortSignal,
  type CompletionRequestOptions,
} from '../ai-provider.types';
import type { OpenAIConnectionConfig } from '../openai/shared';
import { reasoningEffortToBudget } from '../adapters/anthropic-reasoning';

/**
 * Gemini's connection config is structurally identical to OpenAI's
 * (just an `apiKey`) but aliased here so future Gemini-only fields
 * (e.g. Vertex AI service-account credentials, project / location)
 * stay typed without leaking back into the OpenAI provider.
 */
export type GeminiConnectionConfig = OpenAIConnectionConfig;

/**
 * Build a `GoogleGenAI` client from a `GeminiConnectionConfig`. Throws
 * a 400 `CompletionError` if the connection is missing an API key —
 * matches the pattern used by the OpenAI client constructor so the
 * gateway surfaces "invalid_api_key" the same way across providers.
 */
export function createGeminiClient(
  connection: AIConnectionEntity<GeminiConnectionConfig>
): GoogleGenAI {
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
  return new GoogleGenAI({ apiKey: connection.config.apiKey });
}

/**
 * Map an OpenAI/Anthropic-style `reasoning_effort` enum to Gemini's
 * `thinkingConfig`. The token budget tiers are shared with the
 * Anthropic mapper (see `adapters/anthropic-reasoning.ts`) so changing
 * the scale once propagates everywhere.
 *
 * `'none'` (Chat-API extension) maps to `thinkingBudget: 0` (disabled).
 * `'minimal'` is treated as disabled too (same as the Anthropic
 * mapping). Anything we don't recognise falls back to `undefined`
 * so the upstream applies its model-default.
 */
export function mapReasoningEffortToThinking(
  effort: string | null | undefined,
  maxTokens?: number
): ThinkingConfig | undefined {
  if (effort == null) return undefined;
  if (effort === 'none' || effort === 'minimal') {
    return { includeThoughts: false, thinkingBudget: 0 };
  }
  const budget = reasoningEffortToBudget(effort, maxTokens);
  if (budget == null) return undefined;
  return { includeThoughts: true, thinkingBudget: budget };
}

/**
 * Coerce a caller-supplied JSON Schema into the shape Gemini accepts
 * under `responseJsonSchema` / `parametersJsonSchema`. Today this is
 * an identity cast — Gemini takes JSON Schema directly — but the
 * indirection gives us one place to massage if/when the upstream
 * tightens its acceptance.
 */
export function coerceJsonSchema(schema: unknown): Record<string, unknown> {
  if (schema && typeof schema === 'object' && !Array.isArray(schema)) {
    return schema as Record<string, unknown>;
  }
  return {};
}

/**
 * Parse a `data:<mime>;base64,<data>` URL into its components, or
 * return `null` if the input is anything else. Used by all three
 * input-shape converters to lift OpenAI/Anthropic data URLs into
 * Gemini `inlineData` parts.
 */
export function parseDataUrl(
  url: string
): { mimeType: string; data: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/.exec(url);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

/**
 * The same `FinishReason` value needs three different downstream
 * representations:
 *   - OpenAI Chat Completions `finish_reason`
 *   - OpenAI Responses `status` (we map at the per-Response-item level)
 *   - Anthropic `stop_reason`
 *
 * Centralised so the per-format converters stay narrow. Note: we
 * surface `MALFORMED_FUNCTION_CALL` / `UNEXPECTED_TOOL_CALL` as
 * `content_filter` / `refusal` in their respective shapes (they're
 * effectively a refusal of the requested action).
 */
export type MappedFinishReason = {
  openai: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'function_call';
  anthropic:
    | 'end_turn'
    | 'max_tokens'
    | 'stop_sequence'
    | 'tool_use'
    | 'pause_turn'
    | 'refusal'
    | null;
};

export function mapFinishReason(
  reason: GeminiFinishReason | string | undefined,
  hasFunctionCall: boolean
): MappedFinishReason {
  if (hasFunctionCall && (reason === GeminiFinishReason.STOP || !reason)) {
    return { openai: 'tool_calls', anthropic: 'tool_use' };
  }
  switch (reason) {
    case GeminiFinishReason.STOP:
      return { openai: 'stop', anthropic: 'end_turn' };
    case GeminiFinishReason.MAX_TOKENS:
      return { openai: 'length', anthropic: 'max_tokens' };
    case GeminiFinishReason.SAFETY:
    case GeminiFinishReason.PROHIBITED_CONTENT:
    case GeminiFinishReason.SPII:
    case GeminiFinishReason.BLOCKLIST:
    case GeminiFinishReason.IMAGE_SAFETY:
    case GeminiFinishReason.IMAGE_PROHIBITED_CONTENT:
      return { openai: 'content_filter', anthropic: 'refusal' };
    case GeminiFinishReason.RECITATION:
    case GeminiFinishReason.LANGUAGE:
      return { openai: 'content_filter', anthropic: 'refusal' };
    case GeminiFinishReason.MALFORMED_FUNCTION_CALL:
    case GeminiFinishReason.UNEXPECTED_TOOL_CALL:
      return { openai: 'content_filter', anthropic: 'refusal' };
    case GeminiFinishReason.OTHER:
    case GeminiFinishReason.FINISH_REASON_UNSPECIFIED:
    default:
      return { openai: 'stop', anthropic: 'end_turn' };
  }
}

/**
 * Translate Gemini's `usageMetadata` into the three audit-row /
 * client-visible usage shapes. Per-modality breakdown is preserved
 * verbatim under `prompt_tokens_details` so downstream cost
 * accounting can split text vs image vs audio without re-querying.
 */
export type MappedUsage = {
  openai: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_tokens_details?: {
      cached_tokens?: number;
      modality_breakdown?: UsageMetadata['promptTokensDetails'];
    };
    completion_tokens_details?: {
      reasoning_tokens?: number;
      modality_breakdown?: UsageMetadata['responseTokensDetails'];
    };
  };
  anthropic: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number | null;
    cache_read_input_tokens: number | null;
    cache_creation: null;
    server_tool_use: null;
    service_tier: null;
    inference_geo: null;
  };
  responses: {
    input_tokens: number;
    input_tokens_details: { cached_tokens: number };
    output_tokens: number;
    output_tokens_details: { reasoning_tokens: number };
    total_tokens: number;
  };
};

export function mapUsageMetadata(
  usage: UsageMetadata | undefined
): MappedUsage {
  const prompt = usage?.promptTokenCount ?? 0;
  // `GenerateContentResponse.usageMetadata` is actually
  // `GenerateContentResponseUsageMetadata`, which exposes
  // `candidatesTokenCount` rather than the `responseTokenCount`
  // documented on the bare `UsageMetadata` interface. Read both so the
  // counter works whichever shape the SDK returned.
  const usageAny = usage as
    | (UsageMetadata & {
        candidatesTokenCount?: number;
        candidatesTokensDetails?: UsageMetadata['responseTokensDetails'];
      })
    | undefined;
  const completion =
    usageAny?.candidatesTokenCount ?? usage?.responseTokenCount ?? 0;
  const cached = usage?.cachedContentTokenCount ?? 0;
  const reasoning = usage?.thoughtsTokenCount ?? 0;
  const total = usage?.totalTokenCount ?? prompt + completion + reasoning;
  return {
    openai: {
      prompt_tokens: prompt,
      // OpenAI's `completion_tokens` is the full visible+invisible output
      // tally (thinking tokens included). The thinking subset is then
      // surfaced under `completion_tokens_details.reasoning_tokens`.
      // Anthropic / Responses mappers below already roll up the same way.
      completion_tokens: completion + reasoning,
      total_tokens: total,
      prompt_tokens_details: {
        cached_tokens: cached,
        modality_breakdown: usage?.promptTokensDetails,
      },
      completion_tokens_details: {
        reasoning_tokens: reasoning,
        modality_breakdown:
          usageAny?.candidatesTokensDetails ?? usage?.responseTokensDetails,
      },
    },
    anthropic: {
      input_tokens: prompt,
      output_tokens: completion + reasoning,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: cached > 0 ? cached : null,
      cache_creation: null,
      server_tool_use: null,
      service_tier: null,
      inference_geo: null,
    },
    responses: {
      input_tokens: prompt,
      input_tokens_details: { cached_tokens: cached },
      output_tokens: completion + reasoning,
      output_tokens_details: { reasoning_tokens: reasoning },
      total_tokens: total,
    },
  };
}

/**
 * Shape carried by streaming converters so they can fold per-chunk
 * metadata into a single closing message_delta / response.completed
 * event without re-parsing.
 */
export type StreamAccumulator = {
  usage?: UsageMetadata;
  finishReason?: GeminiFinishReason | string;
  hasFunctionCall: boolean;
  grounding: unknown;
  urlContext: unknown;
};

export function newStreamAccumulator(): StreamAccumulator {
  return {
    usage: undefined,
    finishReason: undefined,
    hasFunctionCall: false,
    grounding: undefined,
    urlContext: undefined,
  };
}

/**
 * Wrap a Gemini SDK error as a `CompletionError`. Mirrors the
 * 429/5xx retryable-vs-not logic the other providers use so the
 * gateway's retry/fallback machinery doesn't need a Gemini-specific
 * branch.
 */
export function geminiErrorToCompletionError(
  error: unknown,
  providerRequestPayload: unknown
): CompletionError {
  if (error instanceof CompletionError) {
    if (
      error.data.providerRequestPayload === undefined &&
      providerRequestPayload !== undefined
    ) {
      error.data.providerRequestPayload = providerRequestPayload;
    }
    return error;
  }
  const err = error as Error & { status?: number; statusCode?: number };
  const statusCode =
    err.status ?? err.statusCode ?? HttpStatus.INTERNAL_SERVER_ERROR;
  return new CompletionError(
    {
      rate: statusCode === 429,
      message: err.message ?? 'Gemini native request failed',
      statusCode,
      retryable:
        statusCode === 429 || [500, 502, 503, 504].includes(statusCode),
      failureReason: 'External API error',
      openAICompatibleError: { code: 'gemini_native_error' },
      providerRequestPayload,
    },
    err
  );
}

/**
 * Shared wire-call dispatcher for the three Gemini provider classes.
 * Owns the @google/genai SDK instantiation, abort-signal composition,
 * and exception → `CompletionError` mapping. Format-specific provider
 * classes inject this dispatcher and call `dispatch(params, …)` or
 * `dispatchStream(params, …)`.
 *
 * Returns the parsed native `GenerateContentResponse` (non-streaming)
 * or `AsyncIterable<GenerateContentResponse>` (streaming) verbatim —
 * downstream converters in the per-format provider files do the
 * shape mapping. This keeps the dispatcher and the converters
 * independently testable.
 */
@Injectable()
export class GeminiDispatcher {
  constructor(protected readonly logger: PinoLogger) {}

  async dispatch(
    params: GenerateContentParameters,
    connection: AIConnectionEntity<GeminiConnectionConfig>,
    options?: CompletionRequestOptions
  ): Promise<{
    data: GenerateContentResponse;
    providerRequestPayload: GenerateContentParameters;
  }> {
    const client = createGeminiClient(connection);
    const augmented = this.withAbortSignal(params, options);
    this.logger.info({ params: augmented }, 'Gemini native request');
    try {
      const response = await client.models.generateContent(augmented);
      return { data: response, providerRequestPayload: augmented };
    } catch (error) {
      throw geminiErrorToCompletionError(error, augmented);
    }
  }

  async dispatchStream(
    params: GenerateContentParameters,
    connection: AIConnectionEntity<GeminiConnectionConfig>,
    options?: CompletionRequestOptions
  ): Promise<{
    data: AsyncIterable<GenerateContentResponse>;
    providerRequestPayload: GenerateContentParameters;
  }> {
    const client = createGeminiClient(connection);
    const augmented = this.withAbortSignal(params, options);
    this.logger.info({ params: augmented }, 'Gemini native stream request');
    try {
      // Kick the request off eagerly so transport / auth errors
      // surface here (mappable to a `CompletionError`) instead of
      // from inside the async iterator the gateway is about to
      // forward.
      const stream = await client.models.generateContentStream(augmented);
      return { data: stream, providerRequestPayload: augmented };
    } catch (error) {
      throw geminiErrorToCompletionError(error, augmented);
    }
  }

  /**
   * Compose the controller's disconnect signal with the caller's
   * timeout (if any) and attach to the params under
   * `config.abortSignal` — the only cancellation hook the SDK exposes.
   */
  private withAbortSignal(
    params: GenerateContentParameters,
    options?: CompletionRequestOptions
  ): GenerateContentParameters {
    const signal = composeAbortSignal(options);
    if (!signal) return params;
    const config: GenerateContentConfig = {
      ...(params.config ?? {}),
      abortSignal: signal,
    };
    return { ...params, config };
  }
}

/**
 * Generate an OpenAI-shape response id (`chatcmpl-…` / `gemini-…`)
 * uniformly across the three converters. Gemini's `responseId` is
 * sometimes present on the SDK response object — prefer that when
 * available so the audit row matches what the upstream observed.
 */
export function geminiResponseId(
  response: { responseId?: string } | undefined,
  prefix: string
): string {
  if (response?.responseId) return response.responseId;
  return `${prefix}_${uuidv4()}`;
}

/**
 * Merge gateway-level `vmx.providerArgs` Gemini-only knobs onto the
 * outgoing `GenerateContentConfig`. Lets callers drive native features
 * (`safetySettings`, `responseModalities`, `speechConfig`,
 * `mediaResolution`, `cachedContent`, `labels`, …) the standard request
 * body can't express, without adding a DTO field per knob. Identical
 * behaviour is needed by every per-input-shape converter, so the list
 * lives here.
 */
const GEMINI_PROVIDER_ARG_KEYS: Array<keyof GenerateContentConfig> = [
  'safetySettings',
  'responseModalities',
  'mediaResolution',
  'speechConfig',
  'audioTimestamp',
  'cachedContent',
  'labels',
  'routingConfig',
  'modelSelectionConfig',
  'modelArmorConfig',
  'serviceTier',
  'enableEnhancedCivicAnswers',
  'imageConfig',
  'automaticFunctionCalling',
];

export function applyGeminiProviderArgs(
  config: GenerateContentConfig,
  request: unknown
): void {
  const extras = (
    request as { vmx?: { providerArgs?: Record<string, unknown> } } | null
  )?.vmx?.providerArgs;
  if (!extras || typeof extras !== 'object') return;
  for (const key of GEMINI_PROVIDER_ARG_KEYS) {
    const value = extras[key as string];
    if (value !== undefined) {
      (config as Record<string, unknown>)[key as string] = value;
    }
  }
}

/**
 * Parse a JSON-stringified tool-call arguments blob into a
 * `Record<string, unknown>`. Used by every input-shape converter to
 * lift OpenAI / Anthropic tool-call args onto Gemini's `functionCall.args`.
 * Falls back to `{ value: <parsed> }` for primitives/arrays and
 * `{ _raw: args }` for malformed JSON so the upstream still has
 * something to read.
 */
export function parseToolCallArguments(
  args: string | undefined
): Record<string, unknown> {
  if (!args) return {};
  try {
    const parsed = JSON.parse(args);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { value: parsed };
  } catch {
    return { _raw: args };
  }
}

/**
 * Build a Gemini `ToolConfig.functionCallingConfig` from a normalised
 * mode + optional allowed-function-name. Each input-shape converter
 * extracts its own choice value and dispatches here so the four shapes
 * (`AUTO` / `ANY` / `NONE` / `ANY + allowedFunctionNames`) stay
 * authoritative in one place.
 *
 * - `auto` → AUTO
 * - `any`  → ANY (no allowlist)
 * - `none` → NONE
 * - `named` → ANY + allowedFunctionNames=[name]
 */
export function makeFunctionCallingConfig(
  mode: 'auto' | 'any' | 'none' | 'named',
  name?: string
): ToolConfig {
  switch (mode) {
    case 'auto':
      return {
        functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO },
      };
    case 'any':
      return { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY } };
    case 'none':
      return {
        functionCallingConfig: { mode: FunctionCallingConfigMode.NONE },
      };
    case 'named':
      return {
        functionCallingConfig: {
          mode: FunctionCallingConfigMode.ANY,
          allowedFunctionNames: name ? [name] : [],
        },
      };
  }
}

/**
 * Convert a URL into a Gemini media `Part`. Data URLs lift into
 * `inlineData` (Gemini reads the mime/base64 directly); everything
 * else passes through as `fileData` with the supplied fallback mime
 * so HTTPS / `files/<id>` / GCS URIs survive the hop. Used by every
 * per-input-shape converter for images, documents, audio, etc.
 */
export function urlToMediaPart(url: string, fallbackMime: string): Part {
  const parsed = parseDataUrl(url);
  if (parsed) {
    return { inlineData: { mimeType: parsed.mimeType, data: parsed.data } };
  }
  return { fileData: { fileUri: url, mimeType: fallbackMime } };
}

/**
 * Same shape as `urlToMediaPart` but emits a `FunctionResponsePart`
 * (which only allows `inlineData` / `fileData`, no text). Used when
 * lifting tool-result / function-call-output media onto
 * `functionResponse.parts`.
 */
export function urlToFunctionResponsePart(
  url: string,
  fallbackMime: string
): FunctionResponsePart {
  const parsed = parseDataUrl(url);
  if (parsed) {
    return { inlineData: { mimeType: parsed.mimeType, data: parsed.data } };
  }
  return { fileData: { fileUri: url, mimeType: fallbackMime } };
}

/**
 * Gemini-native `Tool` keys that signal "this entry is already in
 * Gemini wire shape, just passthrough." Used by every input-shape
 * converter to support the `vmx.providerArgs.tools` escape hatch — the
 * orchestrator merges providerArgs into the top-level body before the
 * converter runs, so `tools[]` arrives with a mix of OpenAI/Anthropic
 * entries (the user's original request) and native entries (from
 * `providerArgs`). The cross-format mapping would otherwise silently
 * drop the native entries (no `type` discriminator they recognise).
 */
const GEMINI_NATIVE_TOOL_KEYS = [
  'googleSearch',
  'googleSearchRetrieval',
  'urlContext',
  'codeExecution',
  'fileSearch',
  'computerUse',
  'mcpServer',
  'googleMaps',
  'retrieval',
  'functionDeclarations',
] as const;

export function isGeminiNativeTool(tool: unknown): boolean {
  if (!tool || typeof tool !== 'object') return false;
  return GEMINI_NATIVE_TOOL_KEYS.some(
    (k) => (tool as Record<string, unknown>)[k] !== undefined
  );
}

/**
 * Map a Perplexity-style `search_recency_filter` enum onto a Gemini
 * `googleSearch.timeRangeFilter` `Interval` (startTime/endTime ISO
 * strings). Returns `undefined` for unrecognised values so the caller
 * leaves the field unset and Gemini applies its own default (no
 * time restriction).
 *
 * `endTime` is "now"; `startTime` is now minus the listed window.
 * Values follow Perplexity's docs: `hour`/`day`/`week`/`month`/`year`.
 *
 * Note: `timeRangeFilter` is **Gemini API only** — Vertex AI rejects
 * the field. Our `GeminiConnectionConfig` only supports Gemini API
 * today, so this is safe to emit unconditionally. If Vertex support
 * is added, gate this behind a `connection.config.location == null`
 * check.
 *
 * @param now Override for the current instant — defaults to
 *   `new Date()`. Lets tests pin a stable window without faking the
 *   system clock.
 */
export function recencyFilterToTimeRange(
  recency: string | null | undefined,
  now: Date = new Date()
): { startTime: string; endTime: string } | undefined {
  if (recency == null) return undefined;
  const windowsMs: Record<string, number> = {
    hour: 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000,
    year: 365 * 24 * 60 * 60 * 1000,
  };
  const ms = windowsMs[String(recency).toLowerCase()];
  if (ms == null) return undefined;
  const end = now;
  const start = new Date(end.getTime() - ms);
  // Gemini's protobuf Timestamp rejects fractional seconds with a
  // "Granularity of nano is not supported" 400 — even the `.000` that
  // `Date.toISOString()` always emits trips it. Strip the `.SSSZ`
  // suffix back to second precision (`...Z`) so the wire body is valid.
  return {
    startTime: toGeminiTimestamp(start),
    endTime: toGeminiTimestamp(end),
  };
}

function toGeminiTimestamp(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
