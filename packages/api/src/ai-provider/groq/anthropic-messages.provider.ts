import { Injectable } from '@nestjs/common';
import { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import {
  AnthropicMessagesResponse,
  CompletionRequestOptions,
} from '../ai-provider.types';
import type { AnthropicMessagesRequest } from '../../gateway/anthropic/anthropic.types';
import { dispatchAnthropicMessagesViaOpenAICompat } from '../gemini/anthropic-messages.provider';
import { GroqChatCompletionProvider } from './openai-chat-completion.provider';
import type { OpenAIConnectionConfig } from '../openai/shared';

@Injectable()
export class GroqAnthropicMessagesProvider {
  constructor(
    private readonly chatCompletionProvider: GroqChatCompletionProvider
  ) {}

  handle(
    request: AnthropicMessagesRequest,
    connection: AIConnectionEntity<OpenAIConnectionConfig>,
    model: AIResourceModelConfigEntity,
    options?: CompletionRequestOptions
  ): Promise<AnthropicMessagesResponse> {
    return dispatchAnthropicMessagesViaOpenAICompat(
      this.chatCompletionProvider,
      request,
      connection,
      model,
      options
    );
  }
}
