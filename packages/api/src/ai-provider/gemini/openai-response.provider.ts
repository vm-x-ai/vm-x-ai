import { Injectable } from '@nestjs/common';
import type {
  ChatCompletion,
  ChatCompletionChunk,
} from 'openai/resources/index.js';
import type { ResponseCreateParams } from 'openai/resources/responses/responses.js';
import { v4 as uuidv4 } from 'uuid';
import { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import {
  CompletionRequestOptions,
  OpenAIResponseResponse,
} from '../ai-provider.types';
import { isAsyncIterable } from '../../utils/async';
import {
  chatCompletionStreamToResponseStream,
  chatCompletionToResponse,
  responsesRequestToChatCompletion,
} from '../../gateway/responses/responses-converter';
import type { ResponsesRequestDto } from '../../gateway/responses/dto/responses-request.dto';
import { OpenAIChatCompletionProvider } from '../openai/openai-chat-completion.provider';
import { GeminiChatCompletionProvider } from './openai-chat-completion.provider';
import type { OpenAIConnectionConfig } from '../openai/shared';

/**
 * Direct one-hop `Responses → ChatCompletion → Responses` adapter for
 * OpenAI-compat upstreams that lack a native Responses endpoint
 * (Gemini, Groq, Perplexity). Single converter pair, not an internal
 * pivot — these providers' wire format IS Chat Completions.
 *
 * Exposed as a free function so each provider's `@Injectable`
 * Response class can call it with its own chat-completion dep without
 * needing to inherit through a typed constructor (NestJS DI looks at
 * the constructor parameter types — making the parent generic in the
 * chat-completion subtype would erase the injection target).
 */
export async function dispatchOpenAIResponseViaOpenAICompat(
  chatCompletionProvider: OpenAIChatCompletionProvider,
  request: ResponseCreateParams,
  connection: AIConnectionEntity<OpenAIConnectionConfig>,
  model: AIResourceModelConfigEntity,
  options?: CompletionRequestOptions
): Promise<OpenAIResponseResponse> {
  const chatRequest = responsesRequestToChatCompletion(
    request as ResponsesRequestDto
  );
  const completion = await chatCompletionProvider.handle(
    chatRequest,
    connection,
    model,
    options
  );

  const responseId = `resp_${uuidv4()}`;
  const createdAt = Math.floor(Date.now() / 1000);

  if (isAsyncIterable<ChatCompletionChunk>(completion.data)) {
    return {
      data: chatCompletionStreamToResponseStream(
        completion.data,
        responseId,
        createdAt,
        model.model
      ),
      headers: completion.headers,
      providerRequestPayload: completion.providerRequestPayload,
    };
  }

  return {
    data: chatCompletionToResponse(
      completion.data as ChatCompletion,
      responseId,
      createdAt,
      model.model,
      request as ResponsesRequestDto
    ),
    headers: completion.headers,
    providerRequestPayload: completion.providerRequestPayload,
  };
}

/**
 * Gemini's Responses-input handler — uses the canonical
 * `Responses → ChatCompletion` adapter exported above. Groq and
 * Perplexity have their own `@Injectable` classes that import the
 * same adapter with their own chat-completion implementations.
 */
@Injectable()
export class GeminiResponseProvider {
  constructor(
    private readonly chatCompletionProvider: GeminiChatCompletionProvider
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
