import type {
  Response as OpenAIResponse,
  ResponseStreamEvent,
} from 'openai/resources/responses/responses.js';
import { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import {
  AnthropicMessagesResponse,
  CompletionRequestOptions,
} from '../ai-provider.types';
import type { AnthropicMessagesRequest } from '../../gateway/anthropic/anthropic.types';
import { OpenAIResponseProvider } from './openai-response.provider';
import type { OpenAIConnectionConfig } from './shared';
import {
  requestAnthropicToResponses,
  responseResponsesToAnthropic,
  streamResponsesToAnthropic,
} from './anthropic-messages.provider';

/**
 * Generic `Anthropic-Messages → Responses → Anthropic` dispatcher for
 * upstreams that speak OpenAI's Responses surface natively (today:
 * OpenAI, Groq, Perplexity). Anthropic↔Responses preserves more cross-
 * format fidelity than the older Chat-Completions pivot — typed
 * reasoning items, function_call_output multimodal content, refusal
 * surfacing, and signed thinking all round-trip cleanly on this path.
 *
 * Lives in the OpenAI provider folder because the underlying
 * converter pair (`requestAnthropicToResponses`,
 * `responseResponsesToAnthropic`, `streamResponsesToAnthropic`) is
 * canonical-owned by `openai/anthropic-messages.provider.ts`. Groq and
 * Perplexity reuse this dispatcher because both expose a Responses-
 * compatible endpoint that the OpenAI SDK can talk to.
 */
export async function dispatchAnthropicMessagesViaOpenAIResponses(
  responseProvider: OpenAIResponseProvider,
  request: AnthropicMessagesRequest,
  connection: AIConnectionEntity<OpenAIConnectionConfig>,
  model: AIResourceModelConfigEntity,
  options?: CompletionRequestOptions
): Promise<AnthropicMessagesResponse> {
  const responsesBody = requestAnthropicToResponses(request);
  const native = await responseProvider.handle(
    responsesBody,
    connection,
    model,
    options
  );

  if (
    native.data != null &&
    typeof (native.data as AsyncIterable<ResponseStreamEvent>)[
      Symbol.asyncIterator
    ] === 'function'
  ) {
    return {
      data: streamResponsesToAnthropic(
        native.data as AsyncIterable<ResponseStreamEvent>,
        model.model
      ),
      headers: native.headers,
      providerRequestPayload: native.providerRequestPayload,
    };
  }

  return {
    data: responseResponsesToAnthropic(
      native.data as OpenAIResponse,
      model.model
    ),
    headers: native.headers,
    providerRequestPayload: native.providerRequestPayload,
  };
}
