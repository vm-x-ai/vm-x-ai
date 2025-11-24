import { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import OpenAI from 'openai';
import { throwServiceError } from '../../error';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCode } from '../../error-code';
import { PinoLogger } from 'nestjs-pino';
import { OpenAIProvider } from './openai.provider';
import { CompletionHeaders } from '../ai-provider.types';

export type AnthropicConnectionConfig = {
  apiKey: string;
};

@Injectable()
export class AnthropicProvider extends OpenAIProvider {
  constructor(logger: PinoLogger) {
    super(logger);

    this.provider = {
      id: 'anthropic',
      name: 'Anthropic',
      description: 'Anthropic AI Provider',
      defaultModel: 'claude-haiku-4-5-20251001',
      config: {
        logo: {
          url: '/assets/logos/anthropic.png',
        },
        connection: {
          form: {
            type: 'object',
            title: 'Anthropic Properties',
            required: ['apiKey'],
            properties: {
              apiKey: {
                type: 'string',
                format: 'secret',
                title: 'Anthropic API Key',
                placeholder:
                  'e.g. sk-ant-api-key-1234567890abcdef1234567890abcdef',
                description:
                  'Go to [Anthropic Console](https://console.anthropic.com/settings/keys) to create a Anthropic API Key, e.g. sk-ant-api..........',
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

  protected override async createClient(
    connection: AIConnectionEntity<AnthropicConnectionConfig>
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

    return new OpenAI({
      apiKey: connection.config?.apiKey,
      baseURL: 'https://api.anthropic.com/v1/',
    });
  }

  protected override filterRelevantHeaders(
    headers?: Headers
  ): CompletionHeaders {
    if (!headers) {
      return {};
    }

    const headersMap: Record<string, string> = {
      'x-ratelimit-tokens': 'x-ratelimit-limit-tokens',
      'x-ratelimit-requests': 'x-ratelimit-limit-requests',
    };

    const result: CompletionHeaders = {};
    for (const [key, value] of headers.entries()) {
      if (key.startsWith('x-')) {
        if (headersMap[key]) {
          result[headersMap[key]] = value;
        } else {
          result[key] = value;
        }
      }
    }

    return result;
  }
}
