import { Injectable } from '@nestjs/common';
import { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import {
  AnthropicMessagesResponse,
  CompletionRequestOptions,
} from '../ai-provider.types';
import type { AnthropicMessagesRequest } from '../../gateway/anthropic/anthropic.types';
import {
  AnthropicConnectionConfig,
  AnthropicDispatcher,
  stripGatewayEnvelopes,
} from './shared';

/**
 * Anthropic's native Anthropic-Messages input handler — full
 * input + output passthrough.
 *
 * Strips the gateway's `vmx`/`__vmx_passthrough` envelopes (Anthropic
 * rejects unknown top-level fields) and substitutes the resource's
 * model name, then sends the body verbatim via the dispatcher's
 * `dispatchNative` path. The native `Message` /
 * `AsyncIterable<RawMessageStreamEvent>` data flows back to the
 * orchestrator unchanged — the orchestrator's `detectResponseShape`
 * branch in `mapCompletionResponseToFormat` forwards Anthropic-shape
 * data verbatim, and `extractUsageFromResponse` reads
 * `usage.input_tokens` / `usage.output_tokens` correctly.
 *
 * `providerRequestPayload` captures the exact wire body the Anthropic
 * SDK sees, so the audit row reflects what hit the upstream.
 */
@Injectable()
export class AnthropicMessagesProvider {
  constructor(private readonly dispatcher: AnthropicDispatcher) {}

  handle(
    request: AnthropicMessagesRequest,
    connection: AIConnectionEntity<AnthropicConnectionConfig>,
    model: AIResourceModelConfigEntity,
    options?: CompletionRequestOptions
  ): Promise<AnthropicMessagesResponse> {
    const body: AnthropicMessagesRequest = {
      ...stripGatewayEnvelopes(request),
      model: model.model,
    };
    return this.dispatcher.dispatchNative(body, connection, model, options);
  }
}
