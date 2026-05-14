import Anthropic, { APIError, RateLimitError } from '@anthropic-ai/sdk';
import type {
  Message,
  RawMessageStreamEvent,
} from '@anthropic-ai/sdk/resources/messages';
import { HttpStatus, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import {
  AnthropicMessagesResponse,
  CompletionHeaders,
  CompletionRequestOptions,
  CompletionResponse,
} from '../ai-provider.types';
import { CompletionError } from '../../gateway/completion.types';
import { ErrorCode } from '../../error-code';
import { throwServiceError } from '../../error';
import type { AnthropicMessagesRequest } from '../../gateway/anthropic/anthropic.types';
import { assertClaudeModel } from '../adapters/anthropic-messages.adapter';
import {
  anthropicResponseToChatCompletion,
  anthropicStreamToChatCompletionChunks,
} from './openai-chat-completion.provider';

export type AnthropicConnectionConfig = {
  apiKey: string;
};

/**
 * Native Anthropic rejects `betas` as a body field ("Extra inputs
 * are not permitted"). The canonical opt-in is the `anthropic-beta`
 * HTTP header — a comma-separated list. T9's body-field plumbing
 * works for Bedrock-Invoke (which DOES accept `anthropic_beta` on
 * the body) but not for the native Anthropic API. This helper lifts
 * `betas` off the body and produces the corresponding header.
 */
function liftBetasToHeader(body: AnthropicMessagesRequest): {
  body: AnthropicMessagesRequest;
  betaHeader: Record<string, string> | undefined;
} {
  const { betas, ...rest } = body as AnthropicMessagesRequest & {
    betas?: string[];
  };
  if (!betas || betas.length === 0) {
    return { body, betaHeader: undefined };
  }
  return {
    body: rest,
    betaHeader: { 'anthropic-beta': betas.join(',') },
  };
}

function mergeHeaders(
  forwardHeaders: Record<string, string> | undefined,
  betaHeader: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (!forwardHeaders && !betaHeader) return undefined;
  const out: Record<string, string> = { ...(forwardHeaders ?? {}) };
  if (betaHeader) {
    // If the caller already supplied an `anthropic-beta` header via
    // `forwardHeaders`, append to it (Anthropic accepts comma-
    // separated values; deduping isn't critical).
    const existing = out['anthropic-beta'];
    out['anthropic-beta'] = existing
      ? `${existing},${betaHeader['anthropic-beta']}`
      : betaHeader['anthropic-beta'];
  }
  return out;
}

/**
 * Default per-request timeout (ms) for the Anthropic SDK client.
 *
 * Setting this at the client level — instead of leaving it `null` —
 * suppresses the SDK's `calculateNonstreamingTimeout` check, which
 * throws `'Streaming is required for operations that may take longer
 * than 10 minutes'` whenever a non-streaming call carries a high
 * `max_tokens` (see `@anthropic-ai/sdk/src/client.ts`). The agent CLI
 * routinely sends `max_tokens: 32000` non-streaming retries — that
 * combination tripped the throw and surfaced as a 500 in the audit
 * drawer. 10 minutes matches Anthropic's own server-side ceiling for
 * non-streaming requests, so callers see the same upstream timeout
 * behaviour they'd get talking to Anthropic directly. Per-request
 * `vmx.timeoutMs` still overrides this via the `options.timeout`
 * argument on each call.
 */
const ANTHROPIC_CLIENT_DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Build an Anthropic SDK client from the connection config. Raises
 * `AI_CONNECTION_CONFIG_INVALID` when the apiKey is missing.
 */
export async function createAnthropicClient(
  connection: AIConnectionEntity<AnthropicConnectionConfig>
): Promise<Anthropic> {
  if (!connection.config?.apiKey) {
    throwServiceError(
      HttpStatus.BAD_REQUEST,
      ErrorCode.AI_CONNECTION_CONFIG_INVALID,
      {
        connectionId: connection.connectionId,
        error: 'API Key cannot be found in the AI connection config',
      }
    );
  }
  return new Anthropic({
    apiKey: connection.config.apiKey,
    timeout: ANTHROPIC_CLIENT_DEFAULT_TIMEOUT_MS,
  });
}

/**
 * Map Anthropic's `anthropic-ratelimit-*` headers to OpenAI's
 * `x-ratelimit-*` shape so the gateway's rate-limit accounting code
 * doesn't need to know which provider it just talked to.
 */
export function filterAnthropicHeaders(headers?: Headers): CompletionHeaders {
  if (!headers) return {};
  const headersMap: Record<string, string> = {
    'anthropic-ratelimit-tokens-limit': 'x-ratelimit-limit-tokens',
    'anthropic-ratelimit-requests-limit': 'x-ratelimit-limit-requests',
    'anthropic-ratelimit-tokens-reset': 'x-ratelimit-reset-tokens',
    'anthropic-ratelimit-requests-reset': 'x-ratelimit-reset-requests',
  };
  const result: CompletionHeaders = {};
  for (const [key, value] of headers.entries()) {
    if (key.startsWith('x-') || key.startsWith('anthropic-ratelimit-')) {
      result[headersMap[key] ?? key] = value;
    }
  }
  return result;
}

/**
 * Map an arbitrary thrown error from the Anthropic SDK into the
 * gateway's `CompletionError` shape, attaching the wire body as
 * `providerRequestPayload` so the audit row records what the SDK saw
 * even on the error path.
 */
export function handleAnthropicError(
  error: unknown,
  providerRequestPayload: unknown,
  logger: PinoLogger
): never {
  logger.error({ error }, 'Anthropic request failed');
  if (error instanceof RateLimitError) {
    throw new CompletionError(
      {
        rate: true,
        headers: filterAnthropicHeaders(error.headers),
        message: error.message,
        statusCode: error.status,
        retryable: true,
        failureReason: 'Rate limit exceeded',
        openAICompatibleError: {
          code: 'rate_limit_exceeded',
          type: 'rate_limit_error',
        },
        providerRequestPayload,
      },
      error
    );
  }
  if (error instanceof APIError) {
    const retryableStatus = [500, 502, 503, 504];
    const statusCode = error.status ?? HttpStatus.INTERNAL_SERVER_ERROR;
    throw new CompletionError(
      {
        rate: false,
        headers: filterAnthropicHeaders(error.headers),
        message: error.message,
        statusCode,
        retryable: retryableStatus.includes(statusCode),
        failureReason: 'External API error',
        openAICompatibleError: {
          code: error.error?.error?.type ?? 'unknown_error',
          type: error.error?.error?.type ?? 'unknown_error',
        },
        providerRequestPayload,
      },
      error
    );
  }
  throw new CompletionError(
    {
      rate: false,
      message: (error as Error).message,
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      retryable: false,
      failureReason: 'External API error',
      openAICompatibleError: { code: 'unknown_error' },
      providerRequestPayload,
    },
    error as Error
  );
}

/**
 * Shared SDK-call dispatcher injected into the three format-specific
 * provider classes. Owns the Anthropic Messages API roundtrip; the
 * format-specific provider classes decide whether to forward the
 * native response or convert to ChatCompletion.
 *
 * - `dispatchNative()` returns native Anthropic `Message` /
 *   `RawMessageStreamEvent` shape — used by `AnthropicMessagesProvider`
 *   for true input/output passthrough on the `format: 'anthropic'`
 *   route.
 * - `dispatch()` returns ChatCompletion shape — used by
 *   `AnthropicOpenAICompletionProvider` (cross-format `openAICompletion`
 *   on the Anthropic provider) so the openAICompletion contract holds.
 */
@Injectable()
export class AnthropicDispatcher {
  constructor(private readonly logger: PinoLogger) {}

  /**
   * Native dispatch — returns the SDK's `Message` (non-streaming) or
   * an `AsyncIterable<RawMessageStreamEvent>` (streaming) verbatim.
   * The orchestrator's per-shape handling (`detectResponseShape` +
   * `extractUsageFromResponse`) reads the native shape correctly
   * downstream, so no conversion happens here.
   */
  async dispatchNative(
    body: AnthropicMessagesRequest,
    connection: AIConnectionEntity<AnthropicConnectionConfig>,
    model: AIResourceModelConfigEntity,
    options?: CompletionRequestOptions
  ): Promise<AnthropicMessagesResponse> {
    this.logger.info({ body }, 'Anthropic request body');

    // Run the gates INSIDE the try so a non-Claude model id or a
    // missing apiKey still attaches `providerRequestPayload` on the
    // resulting CompletionError — audit invariant: every error path
    // surfaces the wire body the dispatcher was about to send.
    let client: Anthropic;
    try {
      assertClaudeModel(model.model);
      client = await createAnthropicClient(connection);
    } catch (error) {
      if (error instanceof CompletionError) {
        if (error.data.providerRequestPayload === undefined) {
          error.data.providerRequestPayload = body;
        }
        throw error;
      }
      handleAnthropicError(error, body, this.logger);
    }

    try {
      if (body.stream) {
        const { body: streamBody, betaHeader: streamBetaHeader } =
          liftBetasToHeader(body);
        const streamHeaders = mergeHeaders(
          options?.forwardHeaders,
          streamBetaHeader
        );
        const sdkStream = client.messages.stream(streamBody, {
          signal: options?.signal,
          // Anthropic SDK has a first-class per-request `timeout` —
          // pass the gateway-clamped deadline through so internal
          // SDK retries share the budget and a timeout surfaces as
          // an `APITimeoutError` rather than a generic AbortError.
          ...(options?.timeoutMs != null ? { timeout: options.timeoutMs } : {}),
          // T18: same caller-header forwarding on the streaming path.
          ...(streamHeaders ? { headers: streamHeaders } : {}),
        });
        // `MessageStream.request_id` is a synchronous getter that's
        // `undefined` until the underlying fetch has received its
        // response headers — reading it inline (the previous shape)
        // always returned `undefined`, leaving the audit row's
        // `x-request-id` empty on every streaming call. The SDK's
        // `.withResponse()` is documented as the canonical way to
        // observe the request id; it awaits the response object
        // (cheap — just the headers, not the body) and exposes the id
        // alongside the same `MessageStream` we'd otherwise return.
        const { data: streamWithId, request_id: requestId } =
          await sdkStream.withResponse();
        return {
          data: this.iterateSdkStream(streamWithId, body),
          headers: requestId ? { 'x-request-id': requestId } : {},
          providerRequestPayload: body,
        };
      }
      // `.withResponse()` exposes the underlying Fetch `Response` so
      // we can surface request_id + rate-limit headers to the caller.
      // Without this the `filterAnthropicHeaders()` call below was
      // invoked with `undefined` and returned `{}`, dropping every
      // header on the non-streaming path. (T4)
      //
      // T9 follow-up: native Anthropic rejects `betas` as a body
      // field ("Extra inputs are not permitted"). The canonical
      // shape is the `anthropic-beta` HTTP header (comma-separated).
      // Strip `betas` off the body and merge it into the per-call
      // headers — caught by L9's live test.
      const { body: bodyForWire, betaHeader } = liftBetasToHeader(body);
      const wireHeaders = mergeHeaders(options?.forwardHeaders, betaHeader);
      const {
        data: response,
        response: rawResponse,
        request_id,
      } = await client.messages
        .create(bodyForWire, {
          signal: options?.signal,
          // Native per-request timeout — see the streaming branch.
          ...(options?.timeoutMs != null ? { timeout: options.timeoutMs } : {}),
          // T18: forward whitelisted caller headers (anthropic-beta,
          // anthropic-version, etc.) so beta opt-ins reach Anthropic.
          ...(wireHeaders ? { headers: wireHeaders } : {}),
        })
        .withResponse();
      const headers = filterAnthropicHeaders(rawResponse.headers);
      // SDK already injects `request-id` into headers, but mirror it
      // onto `x-request-id` (the OpenAI-shape key the gateway audit
      // pipeline reads).
      if (request_id && !headers['x-request-id']) {
        headers['x-request-id'] = request_id;
      }
      return {
        data: response,
        headers,
        providerRequestPayload: body,
      };
    } catch (error) {
      if (error instanceof CompletionError) {
        if (error.data.providerRequestPayload === undefined) {
          error.data.providerRequestPayload = body;
        }
        throw error;
      }
      handleAnthropicError(error, body, this.logger);
    }
  }

  /**
   * Converting dispatch — calls `dispatchNative` then runs the
   * canonical Anthropic↔OpenAI converter so the response comes out in
   * ChatCompletion shape. Used by `AnthropicOpenAICompletionProvider`.
   */
  async dispatch(
    body: AnthropicMessagesRequest,
    connection: AIConnectionEntity<AnthropicConnectionConfig>,
    model: AIResourceModelConfigEntity,
    options?: CompletionRequestOptions
  ): Promise<CompletionResponse> {
    const native = await this.dispatchNative(body, connection, model, options);
    if (
      native.data != null &&
      typeof (native.data as AsyncIterable<RawMessageStreamEvent>)[
        Symbol.asyncIterator
      ] === 'function'
    ) {
      return {
        data: anthropicStreamToChatCompletionChunks(
          native.data as AsyncIterable<RawMessageStreamEvent>,
          { requestId: native.headers['x-request-id'], model: model.model }
        ),
        headers: native.headers,
        providerRequestPayload: native.providerRequestPayload,
      };
    }
    return {
      data: anthropicResponseToChatCompletion(native.data as Message, model),
      headers: native.headers,
      providerRequestPayload: native.providerRequestPayload,
    };
  }

  /**
   * Adapt the SDK's `MessageStream` into a plain async iterable of
   * `RawMessageStreamEvent`s. Wraps any mid-stream error so the audit
   * row gets the wire body via `handleAnthropicError`.
   */
  private async *iterateSdkStream(
    sdkStream: AsyncIterable<RawMessageStreamEvent>,
    body: AnthropicMessagesRequest
  ): AsyncIterable<RawMessageStreamEvent> {
    try {
      for await (const event of sdkStream) {
        yield event;
      }
    } catch (error) {
      handleAnthropicError(error, body, this.logger);
    }
  }
}

export { stripPassthroughEnvelope as stripGatewayEnvelopes } from '../passthrough.helpers';
