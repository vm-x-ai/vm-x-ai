import { AIConnectionEntity } from '../ai-connection/entities/ai-connection.entity';
import { AIResourceModelConfigEntity } from '../ai-resource/common/model.entity';
import { AIProviderDto } from './dto/ai-provider.dto';
import OpenAI from 'openai';
import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionCreateParams,
} from 'openai/resources/index.js';
import type {
  Response as OpenAIResponse,
  ResponseCreateParams,
  ResponseStreamEvent,
} from 'openai/resources/responses/responses.js';
import type {
  Message as AnthropicMessage,
  RawMessageStreamEvent,
} from '@anthropic-ai/sdk/resources/messages';
import { RequestAuditEventEntity } from '../audit/entities/audit.entity';
import type { AnthropicMessagesRequest } from '../gateway/anthropic/anthropic.types';

export type CompletionHeaders = {
  'x-request-id'?: string;
  'x-ratelimit-limit-requests'?: string;
  'x-ratelimit-limit-tokens'?: string;
  'x-ratelimit-remaining-requests'?: string;
  'x-ratelimit-remaining-tokens'?: string;
  'x-ratelimit-reset-requests'?: string;
  'x-ratelimit-reset-tokens'?: string;
  [key: string]: string | undefined;
};

/**
 * `vmx` decoration emitted alongside the wire data so the audit row
 * and (for OpenAI Chat Completions only — see D9 in `task.md`) the
 * outgoing chunk stream can carry per-call gateway events + metrics
 * without polluting non-OpenAI native shapes.
 */
export type CompletionResponseInternalData = {
  vmx?: {
    events?: RequestAuditEventEntity[];
    metrics?: {
      gateDurationMs: number | null;
      routingDurationMs: number | null;
      timeToFirstTokenMs: number | null;
      tokensPerSecond: number | null;
    };
  };
};

/**
 * The streaming shape tag. Each per-format provider method returns one
 * of three native chunk types; the orchestrator's
 * `detectStreamChunkShape` (in `response-shape.helpers.ts`) tags each
 * chunk at runtime so the audit + usage paths route correctly.
 */
export type StreamShape =
  | 'openai-chat-completion'
  | 'openai-response'
  | 'anthropic-messages';

/**
 * Optional tagged envelope a provider can return alongside the native
 * stream iterable. The orchestrator's runtime path uses
 * `StreamUsageAccumulator` (see `response-shape.helpers.ts`) and works
 * directly off bare iterables, so providers don't need to wrap; the
 * envelope is provided as an opt-in performance optimisation for
 * providers that already know their output shape and want to skip the
 * per-chunk shape detection (a minor saving for high-cadence
 * Anthropic streams, mostly).
 *
 * No provider currently returns this shape — it's a typing surface so
 * a future provider implementation can opt in without touching the
 * core orchestrator. If/when that lands, `CompletionService.completion`
 * checks `'shape' in providerResponse.data` and routes through the
 * envelope's `extractUsage` instead of `StreamUsageAccumulator`.
 */
export interface NativeStreamEnvelope<TChunk> {
  shape: StreamShape;
  iterable: AsyncIterable<TChunk>;
  /**
   * Stateful extractor — providers wrap their stream in a closure that
   * accumulates input/output tokens across chunks (Anthropic emits
   * input tokens at `message_start` and cumulative output tokens on
   * each `message_delta`; Responses emits final usage at
   * `response.completed`). Returns the latest snapshot or `undefined`
   * if this chunk doesn't carry usage.
   */
  extractUsage: (
    chunk: TChunk
  ) => OpenAI.Completions.CompletionUsage | undefined;
  /** Pulls the upstream message id from the first chunk that carries it. */
  extractMessageId: (chunk: TChunk) => string | null;
}

/** OpenAI Chat Completions response — the format `provider.openAICompletion` returns.
 *  Streaming is a bare iterable today; envelope wrapping for cross-format
 *  usage extraction is a Phase-C follow-up. */
export type OpenAICompletionResponse = {
  data:
    | (ChatCompletion & CompletionResponseInternalData)
    | (AsyncIterable<ChatCompletionChunk> & CompletionResponseInternalData);
  headers: CompletionHeaders;
  providerRequestPayload?: unknown;
};

/** OpenAI Responses response — the format `provider.openAIResponse` returns. */
export type OpenAIResponseResponse = {
  data: OpenAIResponse | AsyncIterable<ResponseStreamEvent>;
  headers: CompletionHeaders;
  providerRequestPayload?: unknown;
};

/** Anthropic Messages response — the format `provider.anthropicMessages` returns. */
export type AnthropicMessagesResponse = {
  data: AnthropicMessage | AsyncIterable<RawMessageStreamEvent>;
  headers: CompletionHeaders;
  providerRequestPayload?: unknown;
};

/** Aliases for legacy ChatCompletion-only consumers — kept while the
 *  per-format service split (Phase E) is in flight. */
export type CompletionNonStreamingResponse = {
  data: ChatCompletion & CompletionResponseInternalData;
  headers: CompletionHeaders;
  providerRequestPayload?: unknown;
};

export type CompletionStreamingResponse = {
  data: AsyncIterable<ChatCompletionChunk> & CompletionResponseInternalData;
  headers: CompletionHeaders;
  providerRequestPayload?: unknown;
};

/** Catch-all type accepted at every legacy ChatCompletion call site —
 *  matches what providers actually return: a union of Chat Completion or
 *  an async stream of Chat Completion chunks. */
export type CompletionResponse = {
  data:
    | (ChatCompletion & CompletionResponseInternalData)
    | (AsyncIterable<ChatCompletionChunk> & CompletionResponseInternalData);
  headers: CompletionHeaders;
  providerRequestPayload?: unknown;
};

/**
 * @deprecated The orchestrator now stores `responseData` as `unknown[]`
 * (JSONB) so each provider can capture its native wire shape. Kept as
 * an alias for any external consumer still importing the legacy
 * narrowed union.
 */
export type CompletionResponseData = ChatCompletion | ChatCompletionChunk;

/**
 * Per-call hooks the gateway can hand to a provider implementation.
 *
 * Currently a single field but typed as an object so additional pass-through
 * concerns (correlation headers, opentelemetry context, etc.) can be added
 * without breaking every provider class.
 */
export type CompletionRequestOptions = {
  /**
   * AbortSignal threaded down to the underlying provider SDK. Tied to
   * external cancellation only — specifically the HTTP client closing
   * the connection upstream (Fastify's request `aborted` event). The
   * caller's `vmx.timeoutMs` / per-model `timeoutMs` come through as
   * `timeoutMs` below, NOT folded into this signal, so SDKs that have
   * a native per-request `timeout` can use their own primitive.
   *
   * Providers MUST forward this to their SDK call so cancellation actually
   * frees up upstream tokens.
   */
  signal?: AbortSignal;

  /**
   * Effective per-call timeout in milliseconds — the minimum of
   * `vmx.timeoutMs` and the per-model `timeoutMs`, clamped to 10
   * minutes. Providers SHOULD forward this to their SDK's native
   * per-request `timeout` option (OpenAI / Anthropic), so the SDK can
   * surface a proper timeout error and apply it across internal retries.
   * For SDKs without a per-request timeout primitive (AWS Bedrock,
   * Google GenAI), use `composeAbortSignal` below to synthesize an
   * `AbortSignal.timeout` and merge it with `signal` before handing
   * the signal to the SDK.
   *
   * `undefined` means "no caller-imposed deadline" — the SDK's default
   * timeout applies (OpenAI / Anthropic default to ~10 min).
   */
  timeoutMs?: number;

  /**
   * Resolved per-model maxRetries (`AIResourceModelConfigEntity.maxRetries`).
   * Providers should hand this to their underlying SDK so transient
   * failures are retried client-side before the gateway falls through
   * to the next fallback model. `0` means "no internal retry, fall
   * through immediately" — the safe default.
   */
  maxRetries?: number;

  /**
   * T18: caller-supplied headers the gateway has been asked to
   * forward to the upstream provider. Populated by per-format
   * services when the connection (or workspace) opts into header
   * forwarding via `forwardCallerHeaders: true`.
   *
   * Keys are lowercased; values are strings (multi-value joined
   * with `, `). Providers attach them to the SDK client's
   * `defaultHeaders` / `extraHeaders` option so they reach the
   * upstream verbatim. Allowed-header lists are enforced at the
   * service layer (only `authorization`, `openai-organization`,
   * `openai-project`, `openai-beta`, `anthropic-version`,
   * `anthropic-beta`, `x-goog-user-project` flow through), so
   * providers can pass everything they receive here without further
   * filtering.
   */
  forwardHeaders?: Record<string, string>;
};

/**
 * Compose an `AbortSignal` for SDKs whose only cancellation primitive
 * is a signal (AWS Bedrock, Google GenAI). Merges `options.signal`
 * (the controller's client-disconnect signal) with an
 * `AbortSignal.timeout(timeoutMs)` if a deadline was supplied. SDKs
 * that have a native per-request `timeout` option should NOT use this
 * — pass `options.timeoutMs` straight through instead so the SDK can
 * surface a typed timeout error and apply it across internal retries.
 */
export function composeAbortSignal(
  options: CompletionRequestOptions | undefined
): AbortSignal | undefined {
  const signals: AbortSignal[] = [];
  if (options?.signal) signals.push(options.signal);
  if (options?.timeoutMs != null && options.timeoutMs > 0) {
    signals.push(AbortSignal.timeout(options.timeoutMs));
  }
  if (signals.length === 0) return undefined;
  if (signals.length === 1) return signals[0];
  return AbortSignal.any(signals);
}

/**
 * Three-method provider interface. Each method:
 * - Receives a request body in its native input format (with the gateway's
 *   `vmx` envelope already stripped).
 * - Returns a response in the SAME format. No format switching anywhere
 *   in the pipeline.
 * - Decides internally whether to passthrough (provider's wire format
 *   matches the input) or convert. No internal pivot format.
 * - Captures `providerRequestPayload` (the wire body the upstream SDK
 *   saw) on every success/error path including mid-stream errors.
 */
export interface CompletionProvider {
  provider: AIProviderDto;

  openAICompletion(
    request: ChatCompletionCreateParams,
    connection: AIConnectionEntity,
    model: AIResourceModelConfigEntity,
    options?: CompletionRequestOptions
  ): Promise<OpenAICompletionResponse>;

  openAIResponse(
    request: ResponseCreateParams,
    connection: AIConnectionEntity,
    model: AIResourceModelConfigEntity,
    options?: CompletionRequestOptions
  ): Promise<OpenAIResponseResponse>;

  anthropicMessages(
    request: AnthropicMessagesRequest,
    connection: AIConnectionEntity,
    model: AIResourceModelConfigEntity,
    options?: CompletionRequestOptions
  ): Promise<AnthropicMessagesResponse>;
}
