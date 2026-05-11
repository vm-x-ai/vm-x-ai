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
import { OpenAIChatCompletionProvider } from './openai-chat-completion.provider';
import { OpenAIResponseProvider } from './openai-response.provider';
import { OpenAIAnthropicMessagesProvider } from './anthropic-messages.provider';
import type { OpenAIConnectionConfig } from './shared';

/**
 * `OpenAIProvider` — composer class implementing the 3-method
 * `CompletionProvider` interface by delegating each input format to
 * its sibling format-specific provider in the same folder.
 *
 * The format-specific classes own their own conversion + SDK call;
 * this composer is just a router. See `task.md` decision D4 for the
 * folder-per-provider layout rationale.
 */
@Injectable()
export class OpenAIProvider implements CompletionProvider {
  provider: AIProviderDto;

  constructor(
    private readonly chatCompletionProvider: OpenAIChatCompletionProvider,
    private readonly responseProvider: OpenAIResponseProvider,
    private readonly anthropicMessagesProvider: OpenAIAnthropicMessagesProvider
  ) {
    this.provider = {
      id: 'openai',
      name: 'OpenAI',
      description: 'OpenAI Provider',
      defaultModel: 'gpt-4.1',
      config: {
        logo: {
          url: '/assets/logos/openai.png',
          darkUrl: '/assets/logos/openai-dark.png',
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
            errorMessage: { required: { apiKey: 'API Key is required' } },
          },
        },
      },
    };
  }

  openAICompletion(
    request: ChatCompletionCreateParams,
    connection: AIConnectionEntity<OpenAIConnectionConfig>,
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
    connection: AIConnectionEntity<OpenAIConnectionConfig>,
    model: AIResourceModelConfigEntity,
    options?: CompletionRequestOptions
  ): Promise<OpenAIResponseResponse> {
    return this.responseProvider.handle(request, connection, model, options);
  }

  anthropicMessages(
    request: AnthropicMessagesRequest,
    connection: AIConnectionEntity<OpenAIConnectionConfig>,
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

export type { OpenAIConnectionConfig };
