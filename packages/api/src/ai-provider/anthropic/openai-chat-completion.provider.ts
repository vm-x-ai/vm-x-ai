import { Injectable } from '@nestjs/common';
import type { ChatCompletionCreateParams } from 'openai/resources/index.js';
import { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import {
  CompletionRequestOptions,
  OpenAICompletionResponse,
} from '../ai-provider.types';
import { openAIRequestToAnthropic } from '../adapters/anthropic-messages.adapter';
import { AnthropicConnectionConfig, AnthropicDispatcher } from './shared';

/**
 * Anthropic's OpenAI-Chat-Completions input handler.
 *
 * Converts the OpenAI body into Anthropic Messages shape (preserving
 * cache_control / thinking / top_k / server tools via the
 * `__vmx_passthrough` envelope), then delegates the wire call to the
 * shared `AnthropicDispatcher`.
 */
@Injectable()
export class AnthropicOpenAICompletionProvider {
  constructor(private readonly dispatcher: AnthropicDispatcher) {}

  async handle(
    request: ChatCompletionCreateParams,
    connection: AIConnectionEntity<AnthropicConnectionConfig>,
    model: AIResourceModelConfigEntity,
    options?: CompletionRequestOptions
  ): Promise<OpenAICompletionResponse> {
    const body = openAIRequestToAnthropic(request);
    body.model = model.model;
    return this.dispatcher.dispatch(body, connection, model, options);
  }
}
