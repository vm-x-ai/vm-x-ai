import { ChatCompletionCreateParams } from 'openai/resources/index.js';
import { Subject } from 'rxjs';
import { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import {
  CompletionObservableData,
  CompletionProvider,
} from '../ai-provider.types';
import {
  AIProviderRateLimitDto,
  AIProviderRateLimitPeriod,
} from '../dto/rate-limit.dto';
import OpenAI, { APIError, RateLimitError } from 'openai';
import { throwServiceError } from '../../error';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCode } from '../../error-code';
import { PinoLogger } from 'nestjs-pino';
import { Stream } from 'openai/core/streaming.js';
import { AIProviderDto } from '../dto/ai-provider.dto';
import { CompletionError } from '../../completion/completion.types';

export type OpenAIConnectionConfig = {
  apiKey: string;
};

@Injectable()
export class OpenAIProvider implements CompletionProvider {
  readonly provider: AIProviderDto;

  constructor(private readonly logger: PinoLogger) {
    this.provider = {
      id: 'openai',
      name: 'OpenAI',
      description: 'OpenAI Provider',
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
        models: [
          {
            value: 'gpt-5',
            label: 'GPT-5',
          },
          {
            value: 'gpt-5-pro',
            label: 'GPT-5 Pro',
          },
          {
            label: 'GPT-4.1 mini',
            value: 'gpt-4.1-mini',
          },
          {
            label: 'GPT-4.1',
            value: 'gpt-4.1',
          },
          {
            label: 'GPT 4o Mini',
            value: 'gpt-4o-mini',
          },
          {
            label: 'GPT 4o',
            value: 'gpt-4o',
          },
          {
            label: 'o1',
            value: 'o1',
          },
          {
            label: 'o1 Mini',
            value: 'o1-mini',
          },
          {
            label: 'GPT-4 Turbo',
            value: 'gpt-4-turbo',
          },
          {
            label: 'GPT-4',
            value: 'gpt-4',
          },
          {
            label: 'GPT-3.5 Turbo',
            value: 'gpt-3.5-turbo',
          },
        ],
      },
    };
  }

  async getRateLimit(
    connection: AIConnectionEntity<OpenAIConnectionConfig>,
    modelConfig: AIResourceModelConfigEntity
  ): Promise<AIProviderRateLimitDto[] | null> {
    const client = await this.createClient(connection);
    const response = await client.chat.completions
      .create({
        stream: false,
        messages: [
          {
            role: 'user',
            content: 'ping, respond with pong',
          },
        ],
        model: modelConfig.model,
      })
      .withResponse();

    // Ref: https://platform.openai.com/docs/guides/rate-limits#rate-limits-in-headers
    const requestsLimit = response.response.headers.get(
      'x-ratelimit-limit-requests'
    );
    const tokensLimit = response.response.headers.get(
      'x-ratelimit-limit-tokens'
    );

    if (!requestsLimit || !tokensLimit) {
      this.logger.warn(
        'The rate limit headers are not present in the response'
      );
      return null;
    }

    return [
      {
        period: AIProviderRateLimitPeriod.MINUTE,
        model: modelConfig.model,
        requests: parseInt(requestsLimit),
        tokens: parseInt(tokensLimit),
      },
    ];
  }

  async completion(
    request: ChatCompletionCreateParams,
    connection: AIConnectionEntity<OpenAIConnectionConfig>,
    model: AIResourceModelConfigEntity,
    observable: Subject<CompletionObservableData>
  ) {
    const client = await this.createClient(connection);
    const startTime = Date.now();
    let timeToFirstToken: number | null = null;
    try {
      const response = await client.chat.completions
        .create({
          ...request,
          model: model.model,
        })
        .withResponse();

      if (response.data instanceof Stream) {
        for await (const chunk of response.data) {
          if (timeToFirstToken === null) {
            timeToFirstToken = Date.now() - startTime;
          }
          observable.next({
            data: chunk,
            headers: Object.fromEntries(response.response.headers.entries()),
          });
        }
      } else {
        observable.next({
          data: response.data,
          headers: Object.fromEntries(response.response.headers.entries()),
        });
      }
    } catch (error) {
      this.logger.error({ error }, 'Failed to complete the request');

      if (error instanceof RateLimitError) {
        const resetTime = this.extractRateLimitResetTime(error.headers);
        throw new CompletionError(
          {
            rate: true,
            headers: Object.fromEntries(error.headers.entries()),
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
            headers: Object.fromEntries(error.headers.entries()),
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
