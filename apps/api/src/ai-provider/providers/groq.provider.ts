import { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import OpenAI from 'openai';
import { throwServiceError } from '../../error';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCode } from '../../error-code';
import { PinoLogger } from 'nestjs-pino';
import { OpenAIProvider } from './openai.provider';

export type GroqConnectionConfig = {
  apiKey: string;
};

@Injectable()
export class GroqProvider extends OpenAIProvider {
  constructor(logger: PinoLogger) {
    super(logger);

    this.provider = {
      id: 'groq',
      name: 'Groq',
      description: 'Groq AI Provider',
      defaultModel: 'openai/gpt-oss-20b',
      config: {
        logo: {
          url: '/assets/logos/groq.png',
        },
        connection: {
          form: {
            type: 'object',
            title: 'Groq Properties',
            required: ['apiKey'],
            properties: {
              apiKey: {
                type: 'string',
                format: 'secret',
                title: 'Groq API Key',
                placeholder:
                  'e.g. gsk_1234567890abcdef1234567890abcdef',
                description:
                  'Go to [Groq Dev Console](https://console.groq.com/keys) to create a Groq API Key, e.g. gsk_..........',
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
    connection: AIConnectionEntity<GroqConnectionConfig>
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
      baseURL: 'https://api.groq.com/openai/v1',
    });
  }
}
