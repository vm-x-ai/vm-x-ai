import { Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { GatewayOrchestratorService } from '../gateway-orchestrator.service';
import { ApiKeyEntity } from '../../api-key/entities/api-key.entity';
import { UserEntity } from '../../users/entities/user.entity';
import { isAsyncIterable } from '../../utils/async';
import { CompletionHeaders } from '../../ai-provider/ai-provider.types';
import type { AnthropicMessagesRequest } from './anthropic.types';
import { anthropicToResponsesRequest } from '../responses/from-anthropic';
import type { CanonicalRequestDto } from '../dto/completion-request.dto';
import { applyVmxHeadersToCanonical } from '../vmx-headers';

export type AnthropicMessagesNonStreamingResult = {
  data: unknown;
  headers: CompletionHeaders;
};

export type AnthropicMessagesStreamingResult = {
  data: AsyncIterable<unknown>;
  headers: CompletionHeaders;
};

export type AnthropicMessagesResult =
  | AnthropicMessagesNonStreamingResult
  | AnthropicMessagesStreamingResult;

/**
 * Per-format service for the Anthropic Messages input. Owns the
 * dispatch end-to-end: builds an OpenAI-shape body (for routing /
 * gating / audit-row scoping), then calls
 * `GatewayOrchestratorService.completion()` with the original Anthropic-shape
 * body threaded through as `originalGatewayRequest` so the
 * orchestrator dispatches via `provider.anthropicMessages(...)` and
 * returns the native Anthropic `Message` / `RawMessageStreamEvent`
 * shape verbatim — no back-conversion in the response side.
 */
@Injectable()
export class AnthropicMessagesService {
  constructor(private readonly completionService: GatewayOrchestratorService) {}

  async send(
    workspaceId: string,
    environmentId: string,
    payload: AnthropicMessagesRequest,
    apiKey?: ApiKeyEntity,
    request?: FastifyRequest,
    user?: UserEntity,
    abortSignal?: AbortSignal
  ): Promise<AnthropicMessagesResult> {
    // Normalize Anthropic Messages → canonical Responses for the
    // orchestrator's routing / gating / token-counting / audit-row
    // scoping. The original Anthropic body is threaded via
    // `originalGatewayRequest` so the dispatch path keeps emitting
    // Anthropic on the wire when the resource resolves to a native
    // Anthropic / Bedrock-Invoke provider.
    const canonical = applyVmxHeadersToCanonical(
      anthropicToResponsesRequest(payload) as CanonicalRequestDto,
      request?.headers
    );
    const result = await this.completionService.completion(
      workspaceId,
      environmentId,
      canonical,
      apiKey,
      request,
      undefined,
      user,
      abortSignal,
      payload,
      { format: 'anthropic', body: payload }
    );

    if (isAsyncIterable(result.data)) {
      return {
        data: result.data,
        headers: result.headers,
      };
    }
    return {
      data: result.data,
      headers: result.headers,
    };
  }
}
