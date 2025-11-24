import { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import OpenAI from 'openai';
import { throwServiceError } from '../../error';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCode } from '../../error-code';
import { PinoLogger } from 'nestjs-pino';
import { OpenAIProvider } from './openai.provider';

export type GeminiConnectionConfig = {
  apiKey: string;
};

@Injectable()
export class GeminiProvider extends OpenAIProvider {
  constructor(logger: PinoLogger) {
    super(logger);

    this.provider = {
      id: 'gemini',
      name: 'Google Gemini',
      description: 'Google Gemini Provider',
      defaultModel: 'gemini-2.5-flash',
      config: {
        logo: {
          url: '/assets/logos/google.png',
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
                title: 'Gemini API Key',
                placeholder:
                  'e.g. AIzaSyA-1234567890abcdef1234567890abcdef',
                description:
                  'Go to [Google AI studio](https://aistudio.google.com/app/apikey) to create a Gemini API Key',
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
    connection: AIConnectionEntity<GeminiConnectionConfig>
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
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    });
  }
}
