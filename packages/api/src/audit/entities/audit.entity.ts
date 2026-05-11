import { ApiProperty, getSchemaPath } from '@nestjs/swagger';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PublicRequestAuditType } from '../../storage/entities.generated';
import { $enum } from 'ts-enum-util';
import type { CompletionHeaders } from '../../ai-provider/ai-provider.types';
import { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import { CompletionRequestDto } from '../../gateway/dto/completion-request.dto';
import { AIRoutingConditionGroup } from '../../ai-resource/common/routing.entity';

export const requestAuditTypes = $enum(PublicRequestAuditType).getKeys();

export enum RequestAuditEventType {
  FALLBACK = 'fallback',
  ROUTING = 'routing',
}

export const requestAuditEventTypes = $enum(RequestAuditEventType).getKeys();

export class RequestAuditBaseEventEntity {
  @ApiProperty({
    description: 'The timestamp of the Audit event',
    example: '2021-01-01T00:00:00.000Z',
  })
  @IsDateString()
  @IsNotEmpty()
  timestamp: Date;
}

export class RequestAuditFallbackEventData {
  @ApiProperty({
    description: 'The model of the Audit event',
    type: AIResourceModelConfigEntity,
  })
  @IsNotEmpty()
  @ValidateNested()
  @Type(() => AIResourceModelConfigEntity)
  model: AIResourceModelConfigEntity;

  @ApiProperty({
    description: 'The failure reason of the Audit event',
    example: 'INVALID_REQUEST',
  })
  @IsString()
  @IsNotEmpty()
  failureReason: string;

  @ApiProperty({
    description: 'The status code of the Audit event',
    example: 400,
  })
  @IsNumber()
  @IsNotEmpty()
  statusCode: number;

  @ApiProperty({
    description: 'The error message of the Audit event',
    example: 'Rate limit exceeded',
  })
  @IsString()
  @IsNotEmpty()
  errorMessage: string;

  @ApiProperty({
    description: 'The headers of the Audit event',
    type: Object,
    additionalProperties: true,
    nullable: true,
    required: false,
  })
  @IsObject()
  @IsOptional()
  headers?: CompletionHeaders | null;
}

export class RequestAuditFallbackEventEntity extends RequestAuditBaseEventEntity {
  @ApiProperty({
    enum: [RequestAuditEventType.FALLBACK],
    description: 'The event type of the Audit event',
    example: 'fallback',
  })
  @IsIn([RequestAuditEventType.FALLBACK])
  @IsString()
  @IsNotEmpty()
  type: RequestAuditEventType.FALLBACK;

  @ApiProperty({
    description: 'The data of the Audit event',
    type: 'object',
    additionalProperties: true,
  })
  @IsNotEmpty()
  @IsObject()
  data: RequestAuditFallbackEventData;
}

export class RequestAuditRoutingEventData {
  @ApiProperty({
    description: 'The original model of the Audit event',
    type: AIResourceModelConfigEntity,
  })
  @IsNotEmpty()
  @ValidateNested()
  @Type(() => AIResourceModelConfigEntity)
  originalModel: AIResourceModelConfigEntity;

  @ApiProperty({
    description: 'The routed model of the Audit event',
    type: AIResourceModelConfigEntity,
  })
  @IsNotEmpty()
  @ValidateNested()
  @Type(() => AIResourceModelConfigEntity)
  routedModel: AIResourceModelConfigEntity;

  @ApiProperty({
    description: 'The matched route of the Audit event',
    type: AIRoutingConditionGroup,
  })
  @IsNotEmpty()
  @ValidateNested()
  @Type(() => AIRoutingConditionGroup)
  matchedRoute: AIRoutingConditionGroup;
}

export class RequestAuditRoutingEventEntity extends RequestAuditBaseEventEntity {
  @ApiProperty({
    enumName: 'RequestAuditEventType',
    enum: requestAuditEventTypes,
    description: 'The event type of the Audit event',
    example: 'routing',
  })
  @IsIn([RequestAuditEventType.ROUTING])
  @IsString()
  @IsNotEmpty()
  type: RequestAuditEventType.ROUTING;

  @ApiProperty({
    description: 'The data of the Audit event',
    type: 'object',
    additionalProperties: true,
  })
  @IsNotEmpty()
  @IsObject()
  data: RequestAuditRoutingEventData;
}

export type RequestAuditEventEntity =
  | RequestAuditFallbackEventEntity
  | RequestAuditRoutingEventEntity;

export class RequestAuditEntity {
  @ApiProperty({
    description: 'The unique identifier for the completion audit event (UUID)',
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid',
  })
  @IsUUID('4')
  @IsNotEmpty()
  id: string;

  @ApiProperty({
    description: 'The timestamp of the completion audit event',
    example: '2021-01-01T00:00:00.000Z',
  })
  @IsDateString()
  @IsNotEmpty()
  timestamp: Date;

  @ApiProperty({
    description:
      'The workspace that the completion audit event is associated with',
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid',
  })
  @IsUUID('4')
  @IsNotEmpty()
  workspaceId: string;

  @ApiProperty({
    description:
      'The environment that the completion audit event is associated with',
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid',
  })
  @IsUUID('4')
  @IsNotEmpty()
  environmentId: string;

  @ApiProperty({
    description:
      'The AI connection that the completion audit event is associated with',
    example: '123e4567-e89b-12d3-a456-426614174000',
    nullable: true,
    required: false,
    type: 'string',
    format: 'uuid',
  })
  @IsUUID('4')
  @IsOptional()
  connectionId?: string | null;

  @ApiProperty({
    enumName: 'RequestAuditType',
    enum: requestAuditTypes,
    description: 'The type of the completion audit event',
    example: PublicRequestAuditType.COMPLETION,
  })
  @IsEnum(PublicRequestAuditType)
  @IsNotEmpty()
  type: PublicRequestAuditType;

  @ApiProperty({
    description: 'The status code of the completion audit event',
    example: 200,
  })
  @IsNumber()
  @IsNotEmpty()
  statusCode: number;

  @ApiProperty({
    description: 'The duration of the completion audit event in milliseconds',
    example: 1000,
  })
  @IsNumber()
  @IsNotEmpty()
  duration: number;

  @ApiProperty({
    description: 'The request ID of the completion audit event',
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid',
  })
  @IsUUID('4')
  @IsNotEmpty()
  requestId: string;

  @ApiProperty({
    description: 'The events of the completion audit event (JSON array)',
    type: [Object],
    items: {
      oneOf: [
        { $ref: getSchemaPath(RequestAuditFallbackEventEntity) },
        { $ref: getSchemaPath(RequestAuditRoutingEventEntity) },
      ],
    },
    nullable: true,
    required: false,
  })
  @IsArray()
  @Type(() => Object, {
    discriminator: {
      property: 'type',
      subTypes: [
        { value: RequestAuditFallbackEventEntity, name: 'fallback' },
        { value: RequestAuditRoutingEventEntity, name: 'routing' },
      ],
    },
  })
  @IsOptional()
  events?: Array<
    RequestAuditFallbackEventEntity | RequestAuditRoutingEventEntity
  > | null;

  @ApiProperty({
    description: 'The batch ID of the completion audit event (if applicable)',
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid',
    nullable: true,
    required: false,
    type: 'string',
  })
  @IsUUID('4')
  @IsOptional()
  batchId?: string | null;

  @ApiProperty({
    description:
      'The correlation ID for correlating logs and events (if applicable)',
    example: 'corr-abc-123',
    nullable: true,
    required: false,
    type: 'string',
  })
  @IsString()
  @IsOptional()
  correlationId?: string | null;

  @ApiProperty({
    description:
      'The associated resource of the completion audit event (if applicable)',
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid',
    nullable: true,
    required: false,
    type: 'string',
  })
  @IsUUID('4')
  @IsOptional()
  resourceId?: string | null;

  @ApiProperty({
    description:
      'The AI Provider of the completion audit event (if applicable)',
    example: 'openai',
    nullable: true,
    required: false,
    type: 'string',
  })
  @IsString()
  @IsOptional()
  provider?: string | null;

  @ApiProperty({
    description:
      'The model involved in the completion audit event (if applicable)',
    example: 'gpt-4o',
    nullable: true,
    required: false,
    type: 'string',
  })
  @IsString()
  @IsOptional()
  model?: string | null;

  @ApiProperty({
    description:
      'The source IP address associated with the completion audit event (if applicable)',
    example: '192.168.1.1',
    nullable: true,
    required: false,
    type: 'string',
  })
  @IsString()
  @IsOptional()
  sourceIp?: string | null;

  @ApiProperty({
    description:
      'The error message if the completion audit event resulted in an error',
    example: 'Rate limit exceeded',
    nullable: true,
    required: false,
    type: 'string',
  })
  @IsString()
  @IsOptional()
  errorMessage?: string | null;

  @ApiProperty({
    description: 'The failure reason if the completion audit event failed',
    example: 'INVALID_REQUEST',
    nullable: true,
    required: false,
    type: 'string',
  })
  @IsString()
  @IsOptional()
  failureReason?: string | null;

  @ApiProperty({
    description:
      'API Key ID related to the completion audit event (if applicable)',
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid',
    nullable: true,
    required: false,
    type: 'string',
  })
  @IsUUID('4')
  @IsOptional()
  apiKeyId?: string | null;

  @ApiProperty({
    description:
      'The user ID related to the completion audit event (if applicable)',
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid',
    nullable: true,
    required: false,
    type: 'string',
  })
  @IsUUID('4')
  @IsOptional()
  userId?: string | null;

  @ApiProperty({
    description:
      'The request payload of the completion audit event in the format the client sent (`openai`, `anthropic`, or `responses`).',
    type: Object,
    additionalProperties: true,
    nullable: true,
    required: false,
  })
  @IsObject()
  @IsOptional()
  requestPayload?: CompletionRequestDto | null;

  @ApiProperty({
    description:
      'The body the provider SDK actually saw on the wire — captured pre-flight so it is available even when the SDK call fails. Differs from `requestPayload` when the provider converted the format internally (e.g. OpenAI client sent Anthropic-shape and the gateway routed to a Claude-on-Bedrock-Invoke connection that received Anthropic shape verbatim).',
    type: Object,
    additionalProperties: true,
    nullable: true,
    required: false,
  })
  @IsObject()
  @IsOptional()
  providerRequestPayload?: unknown;

  @ApiProperty({
    description: 'The response of the completion audit data',
    type: [Object],
    nullable: true,
    required: false,
  })
  /**
   * The wire response (or stream-event array) the upstream actually
   * sent. Typed as `unknown[]` because the shape varies by input
   * format — `ChatCompletion`/`ChatCompletionChunk` for OpenAI Chat
   * Completions, native `Response`/`ResponseStreamEvent` for OpenAI
   * Responses, native Anthropic `Message`/`RawMessageStreamEvent` for
   * Anthropic-shape providers (post-Phase-B). Stored as JSONB; consumers
   * narrow on the shape they expect.
   */
  @IsArray()
  responseData?: unknown[] | null;

  @ApiProperty({
    description: 'The headers of the completion audit data',
    type: Object,
    additionalProperties: true,
    nullable: true,
    required: false,
  })
  @IsObject()
  @IsOptional()
  responseHeaders?: CompletionHeaders | null;

  @ApiProperty({
    description: 'Number of prompt tokens',
    nullable: true,
    required: false,
    type: 'number',
  })
  @IsNumber()
  @IsOptional()
  promptTokens?: number | null;

  @ApiProperty({
    description: 'Number of output tokens generated by the model',
    nullable: true,
    required: false,
    type: 'number',
  })
  @IsNumber()
  @IsOptional()
  outputTokens?: number | null;

  @ApiProperty({
    description: 'Total number of tokens',
    nullable: true,
    required: false,
    type: 'number',
  })
  @IsNumber()
  @IsOptional()
  totalTokens?: number | null;

  @ApiProperty({
    description: 'Number of cached input tokens',
    nullable: true,
    required: false,
    type: 'number',
  })
  @IsNumber()
  @IsOptional()
  cachedTokens?: number | null;

  @ApiProperty({
    description: 'Number of reasoning tokens',
    nullable: true,
    required: false,
    type: 'number',
  })
  @IsNumber()
  @IsOptional()
  reasoningTokens?: number | null;

  @ApiProperty({
    description:
      'Anthropic prompt-cache write tokens (bills at a higher rate than regular input tokens)',
    nullable: true,
    required: false,
    type: 'number',
  })
  @IsNumber()
  @IsOptional()
  cacheCreationInputTokens?: number | null;

  @ApiProperty({
    description: '5-minute-TTL cache creation tokens',
    nullable: true,
    required: false,
    type: 'number',
  })
  @IsNumber()
  @IsOptional()
  cacheCreationEphemeral5mTokens?: number | null;

  @ApiProperty({
    description: '1-hour-TTL cache creation tokens',
    nullable: true,
    required: false,
    type: 'number',
  })
  @IsNumber()
  @IsOptional()
  cacheCreationEphemeral1hTokens?: number | null;

  @ApiProperty({
    description: 'Anthropic web_search tool invocation count',
    nullable: true,
    required: false,
    type: 'number',
  })
  @IsNumber()
  @IsOptional()
  serverToolUseWebSearchRequests?: number | null;

  @ApiProperty({
    description: 'Anthropic code_execution tool invocation count',
    nullable: true,
    required: false,
    type: 'number',
  })
  @IsNumber()
  @IsOptional()
  serverToolUseCodeExecutionRequests?: number | null;

  @ApiProperty({
    description: 'OpenAI audio output tokens',
    nullable: true,
    required: false,
    type: 'number',
  })
  @IsNumber()
  @IsOptional()
  audioTokens?: number | null;

  @ApiProperty({
    description: 'OpenAI predicted-output tokens accepted by the model',
    nullable: true,
    required: false,
    type: 'number',
  })
  @IsNumber()
  @IsOptional()
  acceptedPredictionTokens?: number | null;

  @ApiProperty({
    description: 'OpenAI predicted-output tokens rejected by the model',
    nullable: true,
    required: false,
    type: 'number',
  })
  @IsNumber()
  @IsOptional()
  rejectedPredictionTokens?: number | null;

  @ApiProperty({
    description: 'OpenAI system fingerprint for reproducibility',
    nullable: true,
    required: false,
    type: 'string',
  })
  @IsString()
  @IsOptional()
  systemFingerprint?: string | null;

  @ApiProperty({
    description:
      'Service tier the upstream actually charged at (Anthropic / OpenAI)',
    nullable: true,
    required: false,
    type: 'string',
  })
  @IsString()
  @IsOptional()
  serviceTier?: string | null;

  @ApiProperty({
    description: 'Tokens generated per second',
    nullable: true,
    required: false,
    type: 'number',
  })
  @IsNumber()
  @IsOptional()
  tokensPerSecond?: number | null;

  @ApiProperty({
    description: 'Time to generate the first token (milliseconds)',
    nullable: true,
    required: false,
    type: 'number',
  })
  @IsNumber()
  @IsOptional()
  timeToFirstToken?: number | null;

  @ApiProperty({
    description: 'Total request duration (milliseconds)',
    nullable: true,
    required: false,
    type: 'number',
  })
  @IsNumber()
  @IsOptional()
  requestDuration?: number | null;

  @ApiProperty({
    description: 'Time spent in the AI provider API (milliseconds)',
    nullable: true,
    required: false,
    type: 'number',
  })
  @IsNumber()
  @IsOptional()
  providerDuration?: number | null;

  @ApiProperty({
    description: 'Time spent in the gate service (milliseconds)',
    nullable: true,
    required: false,
    type: 'number',
  })
  @IsNumber()
  @IsOptional()
  gateDuration?: number | null;

  @ApiProperty({
    description: 'Time spent in routing (milliseconds)',
    nullable: true,
    required: false,
    type: 'number',
  })
  @IsNumber()
  @IsOptional()
  routingDuration?: number | null;

  @ApiProperty({
    description: 'Number of errors (1 if request errored, 0 otherwise)',
    nullable: true,
    required: false,
    type: 'number',
  })
  @IsNumber()
  @IsOptional()
  errorCount?: number | null;

  @ApiProperty({
    description: 'Number of successes (1 if request succeeded, 0 otherwise)',
    nullable: true,
    required: false,
    type: 'number',
  })
  @IsNumber()
  @IsOptional()
  successCount?: number | null;

  @ApiProperty({
    description: 'Provider message identifier (response id)',
    nullable: true,
    required: false,
    type: 'string',
  })
  @IsString()
  @IsOptional()
  messageId?: string | null;

  @ApiProperty({
    description: 'Custom metadata attached to the request',
    type: 'object',
    additionalProperties: { type: 'string' },
    nullable: true,
  })
  @IsObject()
  @IsOptional()
  metadata?: Record<string, string> | null;

  @ApiProperty({
    description: 'Cost breakdown for the request',
    type: 'object',
    additionalProperties: true,
    nullable: true,
  })
  @IsObject()
  @IsOptional()
  cost?: CompletionCostBreakdown | null;
}

export interface CompletionCostBreakdown {
  inputCost?: number | null;
  outputCost?: number | null;
  cachedCost?: number | null;
  reasoningCost?: number | null;
  /**
   * Cost of writing fresh entries to the prompt cache. Anthropic
   * bills 5-minute ephemeral writes at 1.25× regular input and 1-hour
   * ephemeral writes at 2× regular input — surface them broken out so
   * cost dashboards can show the real cache-write spend rather than
   * folding it into base input cost.
   */
  cacheCreationCost?: number | null;
  totalCost?: number | null;
  currency?: string | null;
}
