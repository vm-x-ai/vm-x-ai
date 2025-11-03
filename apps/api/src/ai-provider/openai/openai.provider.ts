import { ChatCompletionCreateParams } from 'openai/resources/index.js';
import { Subject } from 'rxjs';
import { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import { CompletionProvider } from '../ai-provider.types';
import {
  AIProviderRateLimitDto,
  AIProviderRateLimitPeriod,
} from '../dto/rate-limit.dto';
import OpenAI from 'openai';
import { throwServiceError } from '../../error';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCode } from '../../error-code';
import { PinoLogger } from 'nestjs-pino';
import { Stream } from 'openai/core/streaming.js';
import { AIProviderDto } from '../dto/ai-provider.dto';

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
    observable: Subject<
      | OpenAI.Chat.Completions.ChatCompletion
      | OpenAI.Chat.Completions.ChatCompletionChunk
    >
  ) {
    const client = await this.createClient(connection);
    const startTime = Date.now();
    let timeToFirstToken: number | null = null;
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
        observable.next(chunk);
      }
    } else {
      observable.next(response.data);
    }
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
