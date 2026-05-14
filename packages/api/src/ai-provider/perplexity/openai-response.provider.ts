import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import type { ResponseCreateParams } from 'openai/resources/responses/responses';
import { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import { OpenAIResponseProvider } from '../openai/openai-response.provider';
import type {
  CompletionRequestOptions,
  OpenAIResponseResponse,
} from '../ai-provider.types';
import {
  type OpenAIConnectionConfig,
  createOpenAIClient,
} from '../openai/shared';
import { PERPLEXITY_RESPONSES_BASE_URL } from './shared';

/**
 * Perplexity exposes an OpenAI Responses-compatible endpoint at
 * `POST /v1/responses` (aliased to their native `/v1/agent`), so we
 * passthrough the Responses body verbatim — no conversion through
 * Chat Completions is involved. The `/v1` prefix is required here;
 * the chat-completions sibling sits on the unversioned host. See
 * `./shared.ts` for the full explanation of the asymmetry.
 *
 * One Perplexity-side deviation from OpenAI Responses: the web-search
 * hosted tool is `{type: 'web_search', filters?: {...}}` rather than
 * OpenAI's `{type: 'web_search_preview'}`. Rename the type before
 * dispatch so callers that drive Perplexity through the canonical
 * OpenAI Responses shape (the playground's `webSearch` toggle, custom
 * SDKs targeting our Responses endpoint, etc.) don't 400 with
 * "unknown tool type".
 *
 * @see https://docs.perplexity.ai/docs/agent-api/openai-compatibility#using-tools
 */
@Injectable()
export class PerplexityResponseProvider extends OpenAIResponseProvider {
  protected override createClient(
    connection: AIConnectionEntity<OpenAIConnectionConfig>
  ): Promise<OpenAI> {
    return createOpenAIClient(connection, PERPLEXITY_RESPONSES_BASE_URL);
  }

  override async handle(
    request: ResponseCreateParams,
    connection: AIConnectionEntity<OpenAIConnectionConfig>,
    model: AIResourceModelConfigEntity,
    options?: CompletionRequestOptions
  ): Promise<OpenAIResponseResponse> {
    return super.handle(
      perplexitiseResponseTools(request),
      connection,
      model,
      options
    );
  }
}

/**
 * Rewrite the `tools[]` array so OpenAI Responses-canonical hosted
 * tools come out in Perplexity's wire shape:
 *
 *   `{type: 'web_search_preview'}`        → `{type: 'web_search'}`
 *   `{type: 'web_search'}` (already)      → passthrough
 *   `{type: 'web_search_preview', filters: {...}}` (caller specified
 *      filters via Perplexity-aware overrides)
 *                                        → `{type: 'web_search', filters: {...}}`
 *
 * Custom function tools and any non-search hosted tools (which
 * Perplexity rejects with 400 anyway) pass through unchanged so the
 * upstream's own error message reaches the caller, instead of us
 * silently stripping them.
 */
export function perplexitiseResponseTools(
  request: ResponseCreateParams
): ResponseCreateParams {
  const tools = request.tools;
  if (!Array.isArray(tools) || tools.length === 0) return request;
  let mutated = false;
  const out = tools.map((t) => {
    const type = (t as { type?: string })?.type;
    if (type === 'web_search_preview') {
      mutated = true;
      const { type: _t, ...rest } = t as { type?: string } & Record<
        string,
        unknown
      >;
      return { type: 'web_search', ...rest };
    }
    return t;
  });
  if (!mutated) return request;
  return { ...request, tools: out as ResponseCreateParams['tools'] };
}
