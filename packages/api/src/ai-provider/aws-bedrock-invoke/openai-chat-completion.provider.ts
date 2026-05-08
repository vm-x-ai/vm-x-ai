import { Injectable } from '@nestjs/common';
import type { ChatCompletionCreateParams } from 'openai/resources/index.js';
import { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import {
  CompletionRequestOptions,
  OpenAICompletionResponse,
} from '../ai-provider.types';
import {
  canonicalAnthropicToBedrockInvoke,
  openAIRequestToAnthropic,
} from '../adapters/anthropic-messages.adapter';
import type { AWSBedrockAIConnectionConfig } from '../aws-bedrock-base';
import {
  ANTHROPIC_BEDROCK_VERSION,
  AWSBedrockInvokeDispatcher,
} from './shared';

/**
 * Bedrock-Invoke handler for OpenAI Chat Completions input.
 *
 * 1. Convert OpenAI body → canonical Anthropic Messages body via the
 *    shared adapter (passes external image URLs through as a hard 400
 *    via `rejectExternalImageUrls`).
 * 2. Re-shape to the Bedrock Invoke wire body (`anthropic_version`
 *    discriminator; strip `model`/`stream` and gateway scaffolding).
 * 3. Dispatch via the shared `AWSBedrockInvokeDispatcher` which owns
 *    the AWS SDK call + event-stream parser.
 */
@Injectable()
export class AWSBedrockInvokeOpenAICompletionProvider {
  constructor(private readonly dispatcher: AWSBedrockInvokeDispatcher) {}

  async handle(
    request: ChatCompletionCreateParams,
    connection: AIConnectionEntity<AWSBedrockAIConnectionConfig>,
    model: AIResourceModelConfigEntity,
    options?: CompletionRequestOptions
  ): Promise<OpenAICompletionResponse> {
    const canonical = openAIRequestToAnthropic(request, {
      rejectExternalImageUrls: true,
    });
    const wireBody = canonicalAnthropicToBedrockInvoke(
      canonical,
      ANTHROPIC_BEDROCK_VERSION
    );
    return this.dispatcher.dispatch(
      wireBody,
      !!request.stream,
      connection,
      model,
      options
    );
  }
}
