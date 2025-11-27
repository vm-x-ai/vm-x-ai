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
import { PublicCompletionAuditType } from '../../../storage/entities.generated';
import { $enum } from 'ts-enum-util';
import type {
  CompletionHeaders,
  CompletionResponseData,
} from '../../../ai-provider/ai-provider.types';
import { AIResourceModelConfigEntity } from '../../../ai-resource/common/model.entity';
import { CompletionRequestDto } from '../../dto/completion-request.dto';
import { AIRoutingConditionGroup } from '../../../ai-resource/common/routing.entity';

export const completionAuditTypes = $enum(PublicCompletionAuditType).getKeys();

export enum CompletionAuditEventType {
  FALLBACK = 'fallback',
  ROUTING = 'routing',
}

export const completionAuditEventTypes = $enum(
  CompletionAuditEventType
).getKeys();

export class CompletionAuditBaseEventEntity {
  @ApiProperty({
    description: 'The timestamp of the Audit event',
    example: '2021-01-01T00:00:00.000Z',
  })
  @IsDateString()
  @IsNotEmpty()
  timestamp: Date;
}

export class CompletionAuditFallbackEventData {
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

export class CompletionAuditFallbackEventEntity extends CompletionAuditBaseEventEntity {
  @ApiProperty({
    enum: [CompletionAuditEventType.FALLBACK],
    description: 'The event type of the Audit event',
    example: 'fallback',
  })
  @IsIn([CompletionAuditEventType.FALLBACK])
  @IsString()
  @IsNotEmpty()
  type: CompletionAuditEventType.FALLBACK;

  @ApiProperty({
    description: 'The data of the Audit event',
    type: 'object',
    additionalProperties: true,
  })
  @IsNotEmpty()
  @IsObject()
  data: CompletionAuditFallbackEventData;
}

export class CompletionAuditRoutingEventData {
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

export class CompletionAuditRoutingEventEntity extends CompletionAuditBaseEventEntity {
  @ApiProperty({
    enumName: 'CompletionAuditEventType',
    enum: completionAuditEventTypes,
    description: 'The event type of the Audit event',
    example: 'routing',
  })
  @IsIn([CompletionAuditEventType.ROUTING])
  @IsString()
  @IsNotEmpty()
  type: CompletionAuditEventType.ROUTING;

  @ApiProperty({
    description: 'The data of the Audit event',
    type: 'object',
    additionalProperties: true,
  })
  @IsNotEmpty()
  @IsObject()
  data: CompletionAuditRoutingEventData;
}

export type CompletionAuditEventEntity =
  | CompletionAuditFallbackEventEntity
  | CompletionAuditRoutingEventEntity;

export class CompletionAuditEntity {
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
    enumName: 'CompletionAuditType',
    enum: completionAuditTypes,
    description: 'The type of the completion audit event',
    example: PublicCompletionAuditType.COMPLETION,
  })
  @IsEnum(PublicCompletionAuditType)
  @IsNotEmpty()
  type: PublicCompletionAuditType;

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
        { $ref: getSchemaPath(CompletionAuditFallbackEventEntity) },
        { $ref: getSchemaPath(CompletionAuditRoutingEventEntity) },
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
        { value: CompletionAuditFallbackEventEntity, name: 'fallback' },
        { value: CompletionAuditRoutingEventEntity, name: 'routing' },
      ],
    },
  })
  @IsOptional()
  events?: Array<
    CompletionAuditFallbackEventEntity | CompletionAuditRoutingEventEntity
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
    example: 'resource-identifier',
    nullable: true,
    required: false,
    type: 'string',
  })
  @IsString()
  @IsOptional()
  resource?: string | null;

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
    description: 'The request payload of the completion audit event (openai chat completion request payload)',
    type: Object,
    additionalProperties: true,
    nullable: true,
    required: false,
  })
  @IsObject()
  @IsOptional()
  requestPayload?: CompletionRequestDto | null;

  @ApiProperty({
    description: 'The response of the completion audit data',
    type: [Object],
    nullable: true,
    required: false,
  })
  @IsArray()
  responseData?: CompletionResponseData[] | null;

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
}
