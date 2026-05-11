import { Injectable } from '@nestjs/common';
import type { ChatCompletionCreateParams } from 'openai/resources/index.js';
import type { ResponseCreateParams } from 'openai/resources/responses/responses.js';
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
import type { AnthropicMessagesRequest } from '../../gateway/anthropic/anthropic.types';
import { AnthropicOpenAICompletionProvider } from './openai-chat-completion.provider';
import { AnthropicOpenAIResponseProvider } from './openai-response.provider';
import { AnthropicMessagesProvider } from './anthropic-messages.provider';
import type { AnthropicConnectionConfig } from './shared';

export type { AnthropicConnectionConfig } from './shared';

/**
 * `AnthropicProvider` — composer implementing the 3-method
 * `CompletionProvider` interface by delegating to the format-specific
 * @Injectable handlers in this folder.
 *
 * Native passthrough is here for `anthropicMessages`; OpenAI Chat
 * Completions and Responses inputs are converted via the shared
 * `anthropic-messages.adapter.ts` (canonical OpenAI↔Anthropic) before
 * the wire call. The Responses path currently routes through the
 * ChatCompletion pivot; a direct Responses↔Anthropic adapter is
 * tracked as a Phase B follow-up.
 */
@Injectable()
export class AnthropicProvider implements CompletionProvider {
  provider: AIProviderDto;

  constructor(
    private readonly chatCompletionProvider: AnthropicOpenAICompletionProvider,
    private readonly responseProvider: AnthropicOpenAIResponseProvider,
    private readonly anthropicMessagesProvider: AnthropicMessagesProvider
  ) {
    this.provider = {
      id: 'anthropic',
      name: 'Anthropic',
      description: 'Anthropic AI Provider',
      defaultModel: 'claude-haiku-4-5',
      config: {
        logo: { url: '/assets/logos/anthropic.png' },
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
            errorMessage: { required: { apiKey: 'API Key is required' } },
          },
        },
      },
    };
  }

  openAICompletion(
    request: ChatCompletionCreateParams,
    connection: AIConnectionEntity<AnthropicConnectionConfig>,
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
    connection: AIConnectionEntity<AnthropicConnectionConfig>,
    model: AIResourceModelConfigEntity,
    options?: CompletionRequestOptions
  ): Promise<OpenAIResponseResponse> {
    return this.responseProvider.handle(request, connection, model, options);
  }

  anthropicMessages(
    request: AnthropicMessagesRequest,
    connection: AIConnectionEntity<AnthropicConnectionConfig>,
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
