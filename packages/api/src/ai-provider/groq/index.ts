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
import { GroqChatCompletionProvider } from './openai-chat-completion.provider';
import { GroqResponseProvider } from './openai-response.provider';
import { GroqAnthropicMessagesProvider } from './anthropic-messages.provider';
import type { OpenAIConnectionConfig } from '../openai/shared';

export type GroqConnectionConfig = OpenAIConnectionConfig;

@Injectable()
export class GroqProvider implements CompletionProvider {
  provider: AIProviderDto;

  constructor(
    private readonly chatCompletionProvider: GroqChatCompletionProvider,
    private readonly responseProvider: GroqResponseProvider,
    private readonly anthropicMessagesProvider: GroqAnthropicMessagesProvider
  ) {
    this.provider = {
      id: 'groq',
      name: 'Groq',
      description: 'Groq AI Provider',
      defaultModel: 'openai/gpt-oss-20b',
      config: {
        logo: { url: '/assets/logos/groq.png' },
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
                placeholder: 'e.g. gsk_1234567890abcdef1234567890abcdef',
                description:
                  'Go to [Groq Dev Console](https://console.groq.com/keys) to create a Groq API Key, e.g. gsk_..........',
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
    connection: AIConnectionEntity<GroqConnectionConfig>,
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
    connection: AIConnectionEntity<GroqConnectionConfig>,
    model: AIResourceModelConfigEntity,
    options?: CompletionRequestOptions
  ): Promise<OpenAIResponseResponse> {
    return this.responseProvider.handle(request, connection, model, options);
  }

  anthropicMessages(
    request: AnthropicMessagesRequest,
    connection: AIConnectionEntity<GroqConnectionConfig>,
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
