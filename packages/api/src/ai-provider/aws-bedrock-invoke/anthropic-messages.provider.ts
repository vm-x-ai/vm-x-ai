import { HttpStatus, Injectable } from '@nestjs/common';
import { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import {
  AnthropicMessagesResponse,
  CompletionRequestOptions,
} from '../ai-provider.types';
import type { AnthropicMessagesRequest } from '../../gateway/anthropic/anthropic.types';
import { canonicalAnthropicToBedrockInvoke } from '../adapters/anthropic-messages.adapter';
import type { AWSBedrockAIConnectionConfig } from '../aws-bedrock-base';
import {
  ANTHROPIC_BEDROCK_VERSION,
  AWSBedrockInvokeDispatcher,
} from './shared';
import { CompletionError } from '../../gateway/completion.types';
import type {
  ContentBlockParam,
  MessageParam,
} from '@anthropic-ai/sdk/resources/messages';

/**
 * T23: Bedrock-Invoke's Anthropic API rejects external image URLs
 * (it can't fetch them server-side). The OpenAI→Anthropic adapter
 * uses `rejectExternalImageUrls: true` to fail fast for the converted
 * path, but the direct Anthropic-input path forwarded URL sources
 * through and got an opaque 400 from Bedrock. This pre-flight catches
 * the case before the SDK call, returning a clean 400 with an
 * actionable message.
 */
function rejectExternalImageUrls(req: AnthropicMessagesRequest): void {
  for (const message of req.messages as MessageParam[]) {
    if (typeof message.content === 'string') continue;
    for (const block of message.content as ContentBlockParam[]) {
      if (block.type !== 'image') continue;
      const src = (block as { source?: { type?: string } }).source;
      if (src?.type === 'url') {
        throw new CompletionError({
          message:
            'AWS Bedrock Invoke (Anthropic) requires base64 data URLs or file_id sources for images, not external URLs. Convert the image to base64 before sending, or route through Bedrock Converse which fetches URLs server-side.',
          rate: false,
          retryable: false,
          statusCode: HttpStatus.BAD_REQUEST,
          failureReason:
            'Anthropic body has an external image URL Bedrock Invoke does not support',
          openAICompatibleError: {
            code: 'aws_bedrock_invoke_image_url_unsupported',
          },
        });
      }
    }
  }
}

/**
 * Bedrock-Invoke handler for Anthropic Messages input — full
 * input + output passthrough. Reshapes the canonical Anthropic body
 * to the Bedrock Invoke wire shape (strip vmx envelopes / `model` /
 * `stream`; add `anthropic_version` discriminator) and dispatches via
 * the native path; the response comes back as native Anthropic
 * `Message` / `RawMessageStreamEvent` shape.
 *
 * The orchestrator's `detectResponseShape` branch in
 * `mapCompletionResponseToFormat` forwards Anthropic-shape data
 * verbatim, and `extractUsageFromResponse` reads
 * `usage.input_tokens` / `usage.output_tokens` correctly.
 */
@Injectable()
export class AWSBedrockInvokeAnthropicMessagesProvider {
  constructor(private readonly dispatcher: AWSBedrockInvokeDispatcher) {}

  async handle(
    request: AnthropicMessagesRequest,
    connection: AIConnectionEntity<AWSBedrockAIConnectionConfig>,
    model: AIResourceModelConfigEntity,
    options?: CompletionRequestOptions
  ): Promise<AnthropicMessagesResponse> {
    rejectExternalImageUrls(request);
    const wireBody = canonicalAnthropicToBedrockInvoke(
      request,
      ANTHROPIC_BEDROCK_VERSION
    );
    return this.dispatcher.dispatchNative(
      wireBody,
      !!request.stream,
      connection,
      model,
      options
    );
  }
}
