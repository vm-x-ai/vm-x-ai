import { Injectable } from '@nestjs/common';
import { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import {
  AnthropicMessagesResponse,
  CompletionProvider,
  CompletionRequestOptions,
  OpenAICompletionResponse,
  OpenAIResponseResponse,
} from '../ai-provider.types';
import { AIProviderDto } from '../dto/ai-provider.dto';
import type { ChatCompletionCreateParams } from 'openai/resources/index.js';
import type { ResponseCreateParams } from 'openai/resources/responses/responses.js';
import type { AnthropicMessagesRequest } from '../../gateway/anthropic/anthropic.types';
import { GeminiChatCompletionProvider } from './openai-chat-completion.provider';
import { GeminiResponseProvider } from './openai-response.provider';
import { GeminiAnthropicMessagesProvider } from './anthropic-messages.provider';
import type { OpenAIConnectionConfig } from '../openai/shared';

/** `GeminiConnectionConfig` is structurally the same as OpenAI's
 *  (just an `apiKey`), but we re-export under a Gemini-named alias
 *  so future Gemini-specific connection fields stay typed. */
export type GeminiConnectionConfig = OpenAIConnectionConfig;

@Injectable()
export class GeminiProvider implements CompletionProvider {
  provider: AIProviderDto;

  constructor(
    private readonly chatCompletionProvider: GeminiChatCompletionProvider,
    private readonly responseProvider: GeminiResponseProvider,
    private readonly anthropicMessagesProvider: GeminiAnthropicMessagesProvider
  ) {
    this.provider = {
      id: 'gemini',
      name: 'Google Gemini',
      description: 'Google Gemini Provider',
      defaultModel: 'gemini-2.5-flash',
      config: {
        logo: { url: '/assets/logos/google.png' },
        connection: {
          form: {
            type: 'object',
            title: 'Gemini Properties',
            required: ['apiKey'],
            properties: {
              apiKey: {
                type: 'string',
                format: 'secret',
                title: 'Gemini API Key',
                placeholder: 'e.g. AIzaSyA-1234567890abcdef1234567890abcdef',
                description:
                  'Go to [Google AI studio](https://aistudio.google.com/app/apikey) to create a Gemini API Key',
              },
            },
            errorMessage: { required: { apiKey: 'API Key is required' } },
          },
        },
      },
    };
  }

  openAICompletion(
    request: ChatCompletionCreateParams,
    connection: AIConnectionEntity<GeminiConnectionConfig>,
    model: AIResourceModelConfigEntity,
    options?: CompletionRequestOptions
  ): Promise<OpenAICompletionResponse> {
    return this.chatCompletionProvider.handle(
      request,
      connection,
      model,
      options
    );
  }

  openAIResponse(
    request: ResponseCreateParams,
    connection: AIConnectionEntity<GeminiConnectionConfig>,
    model: AIResourceModelConfigEntity,
    options?: CompletionRequestOptions
  ): Promise<OpenAIResponseResponse> {
    return this.responseProvider.handle(request, connection, model, options);
  }

  anthropicMessages(
    request: AnthropicMessagesRequest,
    connection: AIConnectionEntity<GeminiConnectionConfig>,
    model: AIResourceModelConfigEntity,
    options?: CompletionRequestOptions
  ): Promise<AnthropicMessagesResponse> {
    return this.anthropicMessagesProvider.handle(
      request,
      connection,
      model,
      options
    );
  }
}
