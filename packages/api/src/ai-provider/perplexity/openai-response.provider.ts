import { Injectable } from '@nestjs/common';
import type { ResponseCreateParams } from 'openai/resources/responses/responses.js';
import { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import {
  CompletionRequestOptions,
  OpenAIResponseResponse,
} from '../ai-provider.types';
import { dispatchOpenAIResponseViaOpenAICompat } from '../gemini/openai-response.provider';
import { PerplexityChatCompletionProvider } from './openai-chat-completion.provider';
import type { OpenAIConnectionConfig } from '../openai/shared';

@Injectable()
export class PerplexityResponseProvider {
  constructor(
    private readonly chatCompletionProvider: PerplexityChatCompletionProvider
  ) {}

  handle(
    request: ResponseCreateParams,
    connection: AIConnectionEntity<OpenAIConnectionConfig>,
    model: AIResourceModelConfigEntity,
    options?: CompletionRequestOptions
  ): Promise<OpenAIResponseResponse> {
    return dispatchOpenAIResponseViaOpenAICompat(
      this.chatCompletionProvider,
      request,
      connection,
      model,
      options
    );
  }
}
