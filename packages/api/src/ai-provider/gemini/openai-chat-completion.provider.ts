import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import type { ChatCompletionCreateParams } from 'openai/resources/index.js';
import { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import {
  CompletionRequestOptions,
  OpenAICompletionResponse,
} from '../ai-provider.types';
import { OpenAIChatCompletionProvider } from '../openai/openai-chat-completion.provider';
import {
  type OpenAIConnectionConfig,
  createOpenAIClient,
} from '../openai/shared';
import {
  dispatchNativeGemini,
  dispatchNativeGeminiStream,
  needsNativeGeminiPath,
} from './native.helpers';

/** Gemini's OpenAI-compat endpoint. */
const GEMINI_BASE_URL =
  'https://generativelanguage.googleapis.com/v1beta/openai';

/**
 * Hybrid Gemini chat-completion provider:
 *
 * - Default path: OpenAI-compat endpoint (covers ~95% of features
 *   downstream consumers use, gets cheap support for OpenAI-shaped
 *   tools, response_format, streaming etc. for free).
 * - Native @google/genai path: kicks in when the request asks for a
 *   Gemini-only tool (currently `googleSearch` and friends). The
 *   compat endpoint either rejects these or silently strips the
 *   resulting grounding metadata; the native SDK preserves it, which
 *   downstream consumers need to render citations.
 */
@Injectable()
export class GeminiChatCompletionProvider extends OpenAIChatCompletionProvider {
  protected override createClient(
    connection: AIConnectionEntity<OpenAIConnectionConfig>
  ): Promise<OpenAI> {
    return createOpenAIClient(connection, GEMINI_BASE_URL);
  }

  override async handle(
    request: ChatCompletionCreateParams,
    connection: AIConnectionEntity<OpenAIConnectionConfig>,
    model: AIResourceModelConfigEntity,
    options?: CompletionRequestOptions
  ): Promise<OpenAICompletionResponse> {
    if (needsNativeGeminiPath(request)) {
      const native = request.stream
        ? await dispatchNativeGeminiStream(
            request,
            connection,
            model.model,
            options
          )
        : await dispatchNativeGemini(request, connection, model.model, options);
      return {
        data: native.data,
        headers: {},
        providerRequestPayload: native.providerRequestPayload,
      };
    }
    return super.handle(request, connection, model, options);
  }
}
