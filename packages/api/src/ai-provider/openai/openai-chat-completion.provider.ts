import { ChatCompletionCreateParams } from 'openai/resources/index.js';
import OpenAI, { APIError, RateLimitError } from 'openai';
import { HttpStatus, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import {
  CompletionRequestOptions,
  OpenAICompletionResponse,
} from '../ai-provider.types';
import { CompletionError } from '../../gateway/completion.types';
import { stripPassthroughEnvelope } from '../passthrough.helpers';
import {
  OpenAIConnectionConfig,
  createOpenAIClient,
  extractRateLimitResetTime,
  filterRelevantHeaders,
} from './shared';

/**
 * OpenAI Chat Completions handler. Owns the SDK call and the error
 * mapping for OpenAI's `/chat/completions` endpoint. Sibling files in
 * the same folder (`openai-response.provider.ts`,
 * `anthropic-messages.provider.ts`) handle the other two input
 * formats — they delegate here when their handler decides to convert
 * via the OpenAI Chat Completions pivot.
 *
 * No adapter logic in this file: this is a pure passthrough — the
 * input is already in the wire shape OpenAI expects.
 */
@Injectable()
export class OpenAIChatCompletionProvider {
  constructor(protected readonly logger: PinoLogger) {}

  /**
   * Subclasses (Gemini/Groq/Perplexity) override to point at their
   * upstream's OpenAI-compat baseURL. The default is OpenAI's
   * production endpoint (no baseURL override).
   */
  protected createClient(
    connection: AIConnectionEntity<OpenAIConnectionConfig>
  ): Promise<OpenAI> {
    return createOpenAIClient(connection);
  }

  async handle(
    request: ChatCompletionCreateParams,
    connection: AIConnectionEntity<OpenAIConnectionConfig>,
    model: AIResourceModelConfigEntity,
    options?: CompletionRequestOptions
  ): Promise<OpenAICompletionResponse> {
    const client = await this.createClient(connection);
    // Strip the gateway's `__vmx_passthrough` envelope before send —
    // OpenAI rejects unknown top-level fields. The envelope carries
    // Anthropic-only features (cache_control, thinking, top_k, server
    // tools); OpenAI consumers can't honour them, so dropping them is
    // the right call here.
    const sanitised = stripPassthroughEnvelope(request);
    // Captured here so it's available to every error path — the audit
    // row's `providerRequestPayload` carries this even when the SDK
    // throws, so ops can debug parsing issues without re-running.
    //
    // `stream_options.include_usage` is force-enabled on every stream
    // so the gateway's billing path sees the final usage chunk —
    // merge over any caller-supplied `stream_options` instead of
    // replacing, so sibling fields (`include_obfuscation`) survive.
    const requestBody = {
      ...sanitised,
      stream_options: sanitised.stream
        ? { ...(sanitised.stream_options ?? {}), include_usage: true }
        : undefined,
      model: model.model,
    };
    try {
      this.logger.info({ requestBody }, 'AI Provider request body');
      const response = await client.chat.completions
        .create(requestBody, {
          signal: options?.signal,
          // The OpenAI SDK has a first-class per-request `timeout` —
          // surfacing a typed `APITimeoutError` and applying the
          // deadline across internal retries. The gateway hands us
          // the already-clamped value, so pass it straight through.
          ...(options?.timeoutMs != null ? { timeout: options.timeoutMs } : {}),
          // Forward the resolved per-model `maxRetries` to the SDK so
          // transient failures retry inside the OpenAI client before
          // the gateway falls through to the next fallback.
          ...(options?.maxRetries != null
            ? { maxRetries: options.maxRetries }
            : {}),
          // T18: pass any caller headers the service layer collected
          // (Authorization, OpenAI-Organization, OpenAI-Project,
          // OpenAI-Beta, anthropic-beta) through to the SDK.
          ...(options?.forwardHeaders &&
          Object.keys(options.forwardHeaders).length > 0
            ? { headers: options.forwardHeaders }
            : {}),
        })
        .withResponse();

      const headers = filterRelevantHeaders(response.response.headers);
      return {
        data: response.data,
        headers,
        providerRequestPayload: requestBody,
      };
    } catch (error) {
      this.logger.error({ error }, 'Failed to complete the request');

      if (error instanceof RateLimitError) {
        const resetTime = extractRateLimitResetTime(error.headers);
        throw new CompletionError(
          {
            rate: true,
            headers: filterRelevantHeaders(error.headers),
            message: error.message,
            statusCode: error.status,
            retryable: true,
            retryDelay: Math.max(
              resetTime.resetRequests,
              resetTime.resetTokens
            ),
            failureReason: 'Rate limit exceeded',
            openAICompatibleError: {
              code: error.code,
              type: error.type,
              param: error.param,
            },
            providerRequestPayload: requestBody,
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
            headers: filterRelevantHeaders(error.headers),
            message: error.message,
            statusCode,
            retryable: retryableStatus.includes(statusCode),
            failureReason: 'External API error',
            openAICompatibleError: {
              code: error.code,
              type: error.type,
              param: error.param,
            },
            providerRequestPayload: requestBody,
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
          providerRequestPayload: requestBody,
        },
        error
      );
    }
  }
}
