import { Injectable } from '@nestjs/common';
import type { ChatCompletionCreateParams } from 'openai/resources/index.js';
import { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import {
  CompletionRequestOptions,
  OpenAICompletionResponse,
} from '../ai-provider.types';
import {
  AWSBedrockAIConnectionConfig,
  AWSBedrockConverseDispatcher,
} from './shared';

/**
 * Bedrock Converse handler for OpenAI Chat Completions input.
 *
 * Bedrock Converse has its own wire shape (distinct from OpenAI Chat
 * Completions and from Anthropic Messages). The shared dispatcher
 * owns the OpenAI ↔ Converse conversion and the SDK call; this
 * handler is a thin wrapper that exposes `dispatcher.completion()`
 * under the `handle()` contract for symmetry with the other providers.
 */
@Injectable()
export class AWSBedrockConverseOpenAICompletionProvider {
  constructor(private readonly dispatcher: AWSBedrockConverseDispatcher) {}

  async handle(
    request: ChatCompletionCreateParams,
    connection: AIConnectionEntity<AWSBedrockAIConnectionConfig>,
    model: AIResourceModelConfigEntity,
    options?: CompletionRequestOptions
  ): Promise<OpenAICompletionResponse> {
    const result = await this.dispatcher.completion(
      request,
      connection,
      model,
      options
    );
    return {
      data: result.data,
      headers: result.headers,
      providerRequestPayload: result.providerRequestPayload,
    };
  }
}
