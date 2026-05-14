import type { ResponseCreateParams } from 'openai/resources/responses/responses.js';
import OpenAI, { APIError, RateLimitError } from 'openai';
import { HttpStatus, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import {
  CompletionRequestOptions,
  OpenAIResponseResponse,
} from '../ai-provider.types';
import { CompletionError } from '../../gateway/completion.types';
import {
  OpenAIConnectionConfig,
  createOpenAIClient,
  extractRateLimitResetTime,
  filterRelevantHeaders,
} from './shared';
import { stripPassthroughEnvelope } from '../passthrough.helpers';

/**
 * OpenAI Responses input handler — native passthrough.
 *
 * Calls `client.responses.create()` directly with the Responses-shape
 * body (after stripping the gateway's `vmx`/`__vmx_passthrough`
 * envelopes). No conversion through ChatCompletion. The response is
 * returned in native Responses shape (`Response` or
 * `AsyncIterable<ResponseStreamEvent>`).
 *
 * This is the canonical D5 native passthrough path. The orchestrator
 * (`CompletionService.complete()` → `mapCompletionResponseToFormat`)
 * detects native shape via `detectResponseShape` and forwards
 * verbatim to the controller; per-format usage extraction in
 * `completion()` reads the native `Response.usage` (input_tokens /
 * output_tokens) via `extractUsageFromResponse`.
 *
 * Subclassing note: Gemini/Groq/Perplexity have their own
 * `Response → ChatCompletion` adapter classes (canonical owner:
 * `gemini/openai-response.provider.ts`) — those upstreams lack a
 * native Responses endpoint, so they convert.
 */
@Injectable()
export class OpenAIResponseProvider {
  constructor(protected readonly logger: PinoLogger) {}

  protected createClient(
    connection: AIConnectionEntity<OpenAIConnectionConfig>
  ): Promise<OpenAI> {
    return createOpenAIClient(connection);
  }

  async handle(
    request: ResponseCreateParams,
    connection: AIConnectionEntity<OpenAIConnectionConfig>,
    model: AIResourceModelConfigEntity,
    options?: CompletionRequestOptions
  ): Promise<OpenAIResponseResponse> {
    const client = await this.createClient(connection);
    // OpenAI rejects unknown top-level fields — drop the gateway
    // envelopes (`vmx` / `__vmx_passthrough`) the SDK doesn't know.
    const sanitised = stripPassthroughEnvelope(request);
    const requestBody: ResponseCreateParams = {
      ...sanitised,
      model: model.model,
    };
    try {
      this.logger.info({ requestBody }, 'AI Provider Responses request body');

      const sdkOptions = {
        signal: options?.signal,
        // Native per-request timeout — see openai-chat-completion for
        // the rationale.
        ...(options?.timeoutMs != null ? { timeout: options.timeoutMs } : {}),
        ...(options?.maxRetries != null
          ? { maxRetries: options.maxRetries }
          : {}),
        // T18: forward whitelisted caller headers (auth/org/project/beta).
        ...(options?.forwardHeaders &&
        Object.keys(options.forwardHeaders).length > 0
          ? { headers: options.forwardHeaders }
          : {}),
      };

      if (requestBody.stream) {
        const streaming = await client.responses
          .create(requestBody, sdkOptions)
          .withResponse();
        const headers = filterRelevantHeaders(streaming.response.headers);
        return {
          data: streaming.data,
          headers,
          providerRequestPayload: requestBody,
        };
      }

      const response = await client.responses
        .create(requestBody, sdkOptions)
        .withResponse();
      const headers = filterRelevantHeaders(response.response.headers);
      return {
        data: response.data,
        headers,
        providerRequestPayload: requestBody,
      };
    } catch (error) {
      this.logger.error({ error }, 'Failed to complete the Responses request');

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
