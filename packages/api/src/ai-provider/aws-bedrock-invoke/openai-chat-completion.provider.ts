import { Injectable } from '@nestjs/common';
import type { ChatCompletionCreateParams } from 'openai/resources/index.js';
import type { RawMessageStreamEvent } from '@anthropic-ai/sdk/resources/messages';
import { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import {
  CompletionRequestOptions,
  OpenAICompletionResponse,
} from '../ai-provider.types';
import type { AnthropicMessagesResponse } from '../../gateway/anthropic/anthropic.types';
import { canonicalAnthropicToBedrockInvoke } from '../adapters/anthropic-messages.adapter';
import {
  anthropicResponseToChatCompletion,
  anthropicStreamToChatCompletionChunks,
  openAIRequestToAnthropic,
} from '../anthropic/openai-chat-completion.provider';
import type { AWSBedrockAIConnectionConfig } from '../aws-bedrock-base';
import {
  ANTHROPIC_BEDROCK_VERSION,
  AWSBedrockInvokeDispatcher,
} from './shared';

/**
 * Bedrock-Invoke handler for OpenAI Chat Completions input.
 *
 * Pipeline:
 *   1. OpenAI body → canonical Anthropic Messages body
 *      (`openAIRequestToAnthropic`, with `rejectExternalImageUrls: true`
 *      since Bedrock can't fetch URLs server-side).
 *   2. Canonical Anthropic → Bedrock-Invoke wire body
 *      (`canonicalAnthropicToBedrockInvoke` strips gateway scaffolding
 *      and adds the `anthropic_version` discriminator).
 *   3. Dispatch through the shared `AWSBedrockInvokeDispatcher.dispatchNative`
 *      to hit InvokeModel(WithResponseStream) and get back the native
 *      Anthropic response (or stream).
 *   4. Native Anthropic response → OpenAI ChatCompletion shape via the
 *      canonical converters in `anthropic/openai-chat-completion.provider`.
 *
 * The shared dispatcher only owns the AWS SDK call + event-stream
 * parser + AWS-exception mapping; the Chat-Completions-specific
 * request shaping and response unwinding live here so siblings that
 * speak Anthropic / Responses on the wire don't pay the cost of
 * importing it.
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
    const native = await this.dispatcher.dispatchNative(
      wireBody,
      !!request.stream,
      connection,
      model,
      options
    );
    if (
      native.data != null &&
      typeof (native.data as AsyncIterable<RawMessageStreamEvent>)[
        Symbol.asyncIterator
      ] === 'function'
    ) {
      return {
        data: anthropicStreamToChatCompletionChunks(
          native.data as AsyncIterable<RawMessageStreamEvent>,
          {
            requestId: native.headers['x-request-id'],
            model: model.model,
          }
        ),
        headers: native.headers,
        providerRequestPayload: native.providerRequestPayload,
      };
    }
    return {
      data: anthropicResponseToChatCompletion(
        native.data as AnthropicMessagesResponse,
        model
      ),
      headers: native.headers,
      providerRequestPayload: native.providerRequestPayload,
    };
  }
}
