import { ApiProperty, OmitType } from '@nestjs/swagger';
import {
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import {
  ChatCompletionCreateParams,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
} from 'openai/resources/index.js';
import { CreateAIResourceDto } from '../../ai-resource/dto/create-ai-resource.dto';
import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import { AIResourceModelRoutingEntity } from '../../ai-resource/common/routing.entity';

export class PartialAIResourceDto extends OmitType(
  PartialType(CreateAIResourceDto),
  ['model', 'fallbackModels', 'secondaryModels', 'routing', 'capacity']
) {
  @IsOptional()
  @ValidateNested()
  @Type(() => PartialType(AIResourceModelConfigEntity))
  model?: Partial<AIResourceModelConfigEntity>;

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => PartialType(AIResourceModelConfigEntity))
  fallbackModels?: Partial<AIResourceModelConfigEntity>[];

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => PartialType(AIResourceModelConfigEntity))
  secondaryModels?: Partial<AIResourceModelConfigEntity>[];

  @IsOptional()
  @ValidateNested()
  @Type(() => PartialType(AIResourceModelRoutingEntity))
  routing?: Partial<AIResourceModelRoutingEntity>;
}

export class ExtraCompletionRequestDto {
  @ApiProperty({
    description: 'The correlation ID for tracing requests',
    example: 'corr-abc-123',
  })
  @IsString()
  @IsOptional()
  correlationId?: string | null;

  @ApiProperty({
    description: 'The index of the secondary model to use',
    example: 0,
  })
  @IsNumber()
  @IsOptional()
  secondaryModelIndex?: number | null;

  @ApiProperty({
    description: 'The resource config overrides',
    example: {
      model: {
        provider: 'openai',
        model: 'gpt-4o',
        connectionId: 'conn-abc-123',
      },
    },
  })
  @ValidateNested()
  @Type(() => PartialAIResourceDto)
  resourceConfigOverrides?: PartialAIResourceDto | null;

  @ApiProperty({
    description:
      'Custom metadata key/value pairs attached to the request for filtering and grouping',
    example: { team: 'platform', project: 'web-search' },
    type: 'object',
    additionalProperties: { type: 'string' },
    nullable: true,
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, string> | null;

  @ApiProperty({
    description:
      'Per-request timeout in milliseconds. The gateway builds an AbortSignal from this and threads it down to the provider SDK so the upstream call is cancelled (and tokens freed) when it elapses. Capped at 600000ms (10 min).',
    example: 30000,
    minimum: 100,
    maximum: 600000,
    nullable: true,
  })
  @IsOptional()
  @IsNumber()
  timeoutMs?: number | null;

  @ApiProperty({
    description:
      'Provider-native fields that override the parsed request body. Useful when the OpenAI / Anthropic compatible endpoint does not natively support a feature of the upstream provider (e.g. Perplexity `search_recency_filter`, Anthropic `top_k`, Gemini `safetySettings`). These fields are merged AFTER `defaultArgs` and the parsed body, so they take precedence over both — even for structured fields like `messages` and `tools`.',
    example: { search_recency_filter: 'week', top_k: 10 },
    type: 'object',
    additionalProperties: true,
    nullable: true,
  })
  @IsOptional()
  @IsObject()
  providerArgs?: Record<string, unknown> | null;
}

export class CompletionRequestPayloadDto {
  @ApiProperty({
    description: 'The extra request data',
    type: ExtraCompletionRequestDto,
  })
  @ValidateNested()
  @Type(() => ExtraCompletionRequestDto)
  @IsOptional()
  vmx?: ExtraCompletionRequestDto | null;
}

export type CompletionRequestDto = ChatCompletionCreateParams &
  CompletionRequestPayloadDto;

export type CompletionNonStreamingRequestDto =
  ChatCompletionCreateParamsNonStreaming & CompletionRequestPayloadDto;

export type CompletionStreamingRequestDto =
  ChatCompletionCreateParamsStreaming & CompletionRequestPayloadDto;

/**
 * Canonical request shape used by the orchestrator (`CompletionService.completion()`).
 *
 * **OpenAI Responses + the VM-X envelopes.** Every public endpoint
 * normalizes its inbound body to this shape before calling the
 * orchestrator (the chat-completions controller via
 * `chatCompletionsToResponsesRequest`, the anthropic controller via
 * `anthropicToResponsesRequest`, the responses controller as a
 * pass-through). Routing / gating / token counting / audit-row
 * scoping all operate on this shape; per-provider dispatch reads the
 * original wire-shape body via the `DispatchedFormat` envelope so
 * native upstreams see their expected request body verbatim.
 */
export type CanonicalRequestDto =
  import('openai/resources/responses/responses.js').ResponseCreateParams &
    CompletionRequestPayloadDto;
