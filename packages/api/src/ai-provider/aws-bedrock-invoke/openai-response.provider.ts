import { Injectable } from '@nestjs/common';
import type { ResponseCreateParams } from 'openai/resources/responses/responses.js';
import type {
  Message as AnthropicMessage,
  RawMessageStreamEvent,
} from '@anthropic-ai/sdk/resources/messages';
import { v4 as uuidv4 } from 'uuid';
import { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import {
  CompletionRequestOptions,
  OpenAIResponseResponse,
} from '../ai-provider.types';
import {
  requestResponsesToAnthropic,
  responseAnthropicToResponses,
  streamAnthropicToResponses,
} from '../anthropic/openai-response.provider';
import { canonicalAnthropicToBedrockInvoke } from '../adapters/anthropic-messages.adapter';
import type { AWSBedrockAIConnectionConfig } from '../aws-bedrock-base';
import {
  ANTHROPIC_BEDROCK_VERSION,
  AWSBedrockInvokeDispatcher,
} from './shared';

/**
 * Bedrock-Invoke handler for OpenAI Responses input — direct
 * Responses↔Anthropic conversion, then Bedrock-Invoke wire shape.
 *
 * Reuses the canonical `requestResponsesToAnthropic` /
 * `responseAnthropicToResponses` / `streamAnthropicToResponses`
 * adapters from `anthropic/openai-response.provider.ts` (Anthropic is
 * the canonical owner of the Responses↔Anthropic converter; Bedrock-
 * Invoke speaks Anthropic on the wire so it imports from there). On
 * top, applies `canonicalAnthropicToBedrockInvoke` to land the
 * `anthropic_version` discriminator + strip `model` / `stream`.
 *
 * No internal pivot through ChatCompletion. The native
 * `Message` / `RawMessageStreamEvent`s coming back from
 * `dispatchNative` flow into the response-side adapter directly.
 */
@Injectable()
export class AWSBedrockInvokeOpenAIResponseProvider {
  constructor(private readonly dispatcher: AWSBedrockInvokeDispatcher) {}

  async handle(
    request: ResponseCreateParams,
    connection: AIConnectionEntity<AWSBedrockAIConnectionConfig>,
    model: AIResourceModelConfigEntity,
    options?: CompletionRequestOptions
  ): Promise<OpenAIResponseResponse> {
    const anthropicBody = {
      ...requestResponsesToAnthropic(request),
      model: model.model,
    };
    const wireBody = canonicalAnthropicToBedrockInvoke(
      anthropicBody,
      ANTHROPIC_BEDROCK_VERSION
    );
    const native = await this.dispatcher.dispatchNative(
      wireBody,
      !!request.stream,
      connection,
      model,
      options
    );

    const responseId = `resp_${uuidv4()}`;
    const createdAt = Math.floor(Date.now() / 1000);

    if (
      native.data != null &&
      typeof (native.data as AsyncIterable<RawMessageStreamEvent>)[
        Symbol.asyncIterator
      ] === 'function'
    ) {
      return {
        data: streamAnthropicToResponses(
          native.data as AsyncIterable<RawMessageStreamEvent>,
          responseId,
          createdAt,
          model.model,
          request
        ),
        headers: native.headers,
        providerRequestPayload: native.providerRequestPayload,
      };
    }
    return {
      data: responseAnthropicToResponses(
        native.data as AnthropicMessage,
        responseId,
        createdAt,
        model.model,
        request
      ),
      headers: native.headers,
      providerRequestPayload: native.providerRequestPayload,
    };
  }
}
