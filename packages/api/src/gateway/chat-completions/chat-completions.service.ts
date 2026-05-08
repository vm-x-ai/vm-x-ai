import { Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { GatewayOrchestratorService } from '../gateway-orchestrator.service';
import { ApiKeyEntity } from '../../api-key/entities/api-key.entity';
import { UserEntity } from '../../users/entities/user.entity';
import { CompletionHeaders } from '../../ai-provider/ai-provider.types';
import {
  type CanonicalRequestDto,
  type CompletionRequestDto,
} from '../dto/completion-request.dto';
import { chatCompletionsToResponsesRequest } from '../responses/from-chat-completions';
import { applyVmxHeadersToCanonical } from '../vmx-headers';

export type ChatCompletionsResult = {
  data: unknown;
  headers: CompletionHeaders;
};

/**
 * Per-format service for the OpenAI Chat Completions input. Symmetric
 * with `ResponsesService` and `AnthropicMessagesService`: normalises
 * the inbound wire body to canonical Responses shape, threads the
 * original Chat Completions body through the
 * `originalGatewayRequest` envelope so dispatch keeps emitting Chat
 * Completions on the wire when the resource resolves to a CC-shape
 * upstream (legacy OpenAI Chat Completions, Gemini/Groq/Perplexity
 * OpenAI-compat, AWS Bedrock-Converse).
 *
 * Owns no VM-X logic of its own — routing, gating, fallback, audit,
 * and cost all live in the shared `GatewayOrchestratorService`.
 */
@Injectable()
export class ChatCompletionsService {
  constructor(private readonly orchestrator: GatewayOrchestratorService) {}

  async complete(
    workspaceId: string,
    environmentId: string,
    payload: CompletionRequestDto,
    apiKey?: ApiKeyEntity,
    request?: FastifyRequest,
    user?: UserEntity,
    abortSignal?: AbortSignal
  ): Promise<ChatCompletionsResult> {
    const canonical = applyVmxHeadersToCanonical(
      chatCompletionsToResponsesRequest(payload) as CanonicalRequestDto,
      request?.headers
    );
    const result = await this.orchestrator.completion(
      workspaceId,
      environmentId,
      canonical,
      apiKey,
      request,
      undefined,
      user,
      abortSignal,
      payload,
      { format: 'chat-completions', body: payload }
    );
    return { data: result.data, headers: result.headers };
  }
}
