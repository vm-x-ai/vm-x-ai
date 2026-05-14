import { Injectable } from '@nestjs/common';
import { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import {
  AnthropicMessagesResponse,
  CompletionRequestOptions,
} from '../ai-provider.types';
import type { AnthropicMessagesRequest } from '../../gateway/anthropic/anthropic.types';
import { dispatchAnthropicMessagesViaOpenAIResponses } from '../openai/anthropic-via-responses';
import { PerplexityResponseProvider } from './openai-response.provider';
import type { OpenAIConnectionConfig } from '../openai/shared';

@Injectable()
export class PerplexityAnthropicMessagesProvider {
  constructor(private readonly responseProvider: PerplexityResponseProvider) {}

  handle(
    request: AnthropicMessagesRequest,
    connection: AIConnectionEntity<OpenAIConnectionConfig>,
    model: AIResourceModelConfigEntity,
    options?: CompletionRequestOptions
  ): Promise<AnthropicMessagesResponse> {
    return dispatchAnthropicMessagesViaOpenAIResponses(
      this.responseProvider,
      request,
      connection,
      model,
      options
    );
  }
}
