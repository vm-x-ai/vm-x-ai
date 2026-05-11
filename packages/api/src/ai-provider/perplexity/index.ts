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
import { PerplexityChatCompletionProvider } from './openai-chat-completion.provider';
import { PerplexityResponseProvider } from './openai-response.provider';
import { PerplexityAnthropicMessagesProvider } from './anthropic-messages.provider';
import type { OpenAIConnectionConfig } from '../openai/shared';

export type PerplexityConnectionConfig = OpenAIConnectionConfig;

@Injectable()
export class PerplexityProvider implements CompletionProvider {
  provider: AIProviderDto;

  constructor(
    private readonly chatCompletionProvider: PerplexityChatCompletionProvider,
    private readonly responseProvider: PerplexityResponseProvider,
    private readonly anthropicMessagesProvider: PerplexityAnthropicMessagesProvider
  ) {
    this.provider = {
      id: 'perplexity',
      name: 'Perplexity',
      description:
        'Perplexity AI Provider (Sonar models with built-in web search)',
      defaultModel: 'sonar-pro',
      config: {
        logo: {
          url: '/assets/logos/perplexity.png',
          darkUrl: '/assets/logos/perplexity-dark.png',
        },
        connection: {
          form: {
            type: 'object',
            title: 'Perplexity Properties',
            required: ['apiKey'],
            properties: {
              apiKey: {
                type: 'string',
                format: 'secret',
                title: 'Perplexity API Key',
                placeholder: 'e.g. pplx-1234567890abcdef',
                description:
                  'Go to [Perplexity Settings](https://www.perplexity.ai/settings/api) to create a Perplexity API Key.',
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
    connection: AIConnectionEntity<PerplexityConnectionConfig>,
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
    connection: AIConnectionEntity<PerplexityConnectionConfig>,
    model: AIResourceModelConfigEntity,
    options?: CompletionRequestOptions
  ): Promise<OpenAIResponseResponse> {
    return this.responseProvider.handle(request, connection, model, options);
  }

  anthropicMessages(
    request: AnthropicMessagesRequest,
    connection: AIConnectionEntity<PerplexityConnectionConfig>,
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
