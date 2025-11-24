import {
  ChatCompletionCreateParams,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
} from 'openai/resources/index.js';
import { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import {
  CompletionHeaders,
  CompletionNonStreamingResponse,
  CompletionProvider,
  CompletionResponse,
  CompletionStreamingResponse,
} from '../ai-provider.types';
import OpenAI, { APIError, RateLimitError } from 'openai';
import { throwServiceError } from '../../error';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCode } from '../../error-code';
import { PinoLogger } from 'nestjs-pino';
import { AIProviderDto } from '../dto/ai-provider.dto';
import { CompletionError } from '../../completion/completion.types';

export type OpenAIConnectionConfig = {
  apiKey: string;
};

@Injectable()
export class OpenAIProvider implements CompletionProvider {
  provider: AIProviderDto;

  constructor(private readonly logger: PinoLogger) {
    this.provider = {
      id: 'openai',
      name: 'OpenAI',
      description: 'OpenAI Provider',
      defaultModel: 'gpt-4.1',
      config: {
        logo: {
          url: '/assets/logos/openai.png',
        },
        connection: {
          form: {
            type: 'object',
            title: 'OpenAI Properties',
            required: ['apiKey'],
            properties: {
              apiKey: {
                type: 'string',
                format: 'secret',
                title: 'OpenAI API Key',
                placeholder: 'e.g. sk-1234567890abcdef1234567890abcdef',
                description:
                  'Go to [OpenAI Platform](https://platform.openai.com/settings/organization/api-keys) to create a OpenAI API Key, e.g. sk-123..........',
              },
            },
            errorMessage: {
              required: {
                apiKey: 'API Key is required',
              },
            },
          },
        },
      },
    };
  }

  completion(
    request: ChatCompletionCreateParamsNonStreaming,
    connection: AIConnectionEntity<OpenAIConnectionConfig>,
    model: AIResourceModelConfigEntity
  ): Promise<CompletionNonStreamingResponse>;

  completion(
    request: ChatCompletionCreateParamsStreaming,
    connection: AIConnectionEntity<OpenAIConnectionConfig>,
    model: AIResourceModelConfigEntity
  ): Promise<CompletionStreamingResponse>;

  completion(
    request: ChatCompletionCreateParams,
    connection: AIConnectionEntity<OpenAIConnectionConfig>,
    model: AIResourceModelConfigEntity
  ): Promise<CompletionResponse>;

  async completion(
    request: ChatCompletionCreateParams,
    connection: AIConnectionEntity<OpenAIConnectionConfig>,
    model: AIResourceModelConfigEntity
  ): Promise<CompletionResponse> {
    const client = await this.createClient(connection);
    try {
      const requestBody = {
        ...request,
        stream_options: request.stream
          ? {
              include_usage: true,
            }
          : undefined,
        model: model.model,
      };
      this.logger.info({ requestBody }, 'AI Provider request body');
      const response = await client.chat.completions
        .create(requestBody)
        .withResponse();

      const headers = this.filterRelevantHeaders(response.response.headers);
      return {
        data: response.data,
        headers,
      };
    } catch (error) {
      this.logger.error({ error }, 'Failed to complete the request');

      if (error instanceof RateLimitError) {
        const resetTime = this.extractRateLimitResetTime(error.headers);
        throw new CompletionError(
          {
            rate: true,
            headers: this.filterRelevantHeaders(error.headers),
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
            headers: this.filterRelevantHeaders(error.headers),
            message: error.message,
            statusCode: statusCode,
            retryable: retryableStatus.includes(statusCode),
            failureReason: 'External API error',
            openAICompatibleError: {
              code: error.code,
              type: error.type,
              param: error.param,
            },
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
          openAICompatibleError: {
            code: 'unknown_error',
          },
        },
        error
      );
    }
  }

  protected filterRelevantHeaders(headers?: Headers): CompletionHeaders {
    if (!headers) {
      return {};
    }

    return Object.fromEntries(
      Array.from(headers.entries()).filter(([key]) => key.startsWith('x-'))
    );
  }

  private extractRateLimitResetTime(headers?: Headers) {
    if (!headers) {
      return {
        resetRequests: 0,
        resetTokens: 0,
      };
    }

    const resetRequests = headers.get('x-ratelimit-reset-requests');
    const resetTokens = headers.get('x-ratelimit-reset-tokens');

    return {
      resetRequests: resetRequests ? this.parseDuration(resetRequests) : 0,
      resetTokens: resetTokens ? this.parseDuration(resetTokens) : 0,
    };
  }

  private parseDuration(durationStr: string | undefined): number {
    if (durationStr === undefined) {
      return 0;
    }

    let totalMillis = 0;
    const timeUnits = {
      h: 3600000,
      m: 60000,
      ms: 1,
      s: 1000,
    };

    const orderedUnits = ['h', 'm', 'ms', 's'];

    for (const unit of orderedUnits) {
      const match = new RegExp(`(\\d+(?:\\.\\d+)?)${unit}(?!\\w)`).exec(
        durationStr
      );
      if (match) {
        const value = parseFloat(match[1]);
        if (unit === 'h') {
          totalMillis += value * timeUnits['h'];
        } else if (unit === 'm') {
          totalMillis += value * timeUnits['m'];
        } else if (unit === 's') {
          totalMillis += value * timeUnits['s'];
        } else if (unit === 'ms') {
          totalMillis += value;
        }
      }
    }

    return totalMillis;
  }

  protected async createClient(
    connection: AIConnectionEntity<OpenAIConnectionConfig>
  ): Promise<OpenAI> {
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

    return new OpenAI({ apiKey: connection.config?.apiKey });
  }
}
