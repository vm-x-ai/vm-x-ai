import { Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type {
  Response,
  ResponseStreamEvent,
} from 'openai/resources/responses/responses';
import { GatewayOrchestratorService } from '../gateway-orchestrator.service';
import { ApiKeyEntity } from '../../api-key/entities/api-key.entity';
import { UserEntity } from '../../users/entities/user.entity';
import {
  ResponsesNonStreamingRequestDto,
  ResponsesRequestDto,
  ResponsesStreamingRequestDto,
} from './dto/responses-request.dto';
import { isAsyncIterable } from '../../utils/async';
import { CompletionHeaders } from '../../ai-provider/ai-provider.types';
import type { CanonicalRequestDto } from '../dto/completion-request.dto';
import { applyVmxHeadersToCanonical } from '../vmx-headers';

export type ResponsesNonStreamingResult = {
  data: Response;
  headers: CompletionHeaders;
};

export type ResponsesStreamingResult = {
  data: AsyncIterable<ResponseStreamEvent>;
  headers: CompletionHeaders;
};

export type ResponsesResult =
  | ResponsesNonStreamingResult
  | ResponsesStreamingResult;

/**
 * Per-format service for the OpenAI Responses input. Owns the dispatch
 * end-to-end: builds an OpenAI-shape body (for routing / gating /
 * audit-row scoping), then calls `GatewayOrchestratorService.completion()` with
 * the original Responses-shape body threaded through as
 * `originalGatewayRequest` so the orchestrator dispatches via
 * `provider.openAIResponse(...)` and returns the native `Response` /
 * `ResponseStreamEvent` shape verbatim — no `mapCompletionResponseToFormat`
 * back-conversion in between.
 */
@Injectable()
export class ResponsesService {
  constructor(private readonly completionService: GatewayOrchestratorService) {}

  async respond(
    workspaceId: string,
    environmentId: string,
    payload: ResponsesNonStreamingRequestDto,
    apiKey?: ApiKeyEntity,
    request?: FastifyRequest,
    user?: UserEntity,
    abortSignal?: AbortSignal
  ): Promise<ResponsesNonStreamingResult>;

  async respond(
    workspaceId: string,
    environmentId: string,
    payload: ResponsesStreamingRequestDto,
    apiKey?: ApiKeyEntity,
    request?: FastifyRequest,
    user?: UserEntity,
    abortSignal?: AbortSignal
  ): Promise<ResponsesStreamingResult>;

  async respond(
    workspaceId: string,
    environmentId: string,
    payload: ResponsesRequestDto,
    apiKey?: ApiKeyEntity,
    request?: FastifyRequest,
    user?: UserEntity,
    abortSignal?: AbortSignal
  ): Promise<ResponsesResult>;

  async respond(
    workspaceId: string,
    environmentId: string,
    payload: ResponsesRequestDto,
    apiKey?: ApiKeyEntity,
    request?: FastifyRequest,
    user?: UserEntity,
    abortSignal?: AbortSignal
  ): Promise<ResponsesResult> {
    // The orchestrator's canonical body shape *is* OpenAI Responses
    // post-canonical-flip — pass `payload` straight through. The
    // `originalGatewayRequest` envelope tells the dispatch path that
    // the wire body is already in Responses format, so
    // `provider.openAIResponse(...)` runs as a passthrough on
    // OpenAI-native and direct-converter cells.
    const canonical = applyVmxHeadersToCanonical(
      payload as CanonicalRequestDto,
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
      { format: 'responses', body: payload as never }
    );

    if (isAsyncIterable(result.data)) {
      return {
        data: result.data as AsyncIterable<ResponseStreamEvent>,
        headers: result.headers,
      };
    }
    return {
      data: result.data as unknown as Response,
      headers: result.headers,
    };
  }
}
