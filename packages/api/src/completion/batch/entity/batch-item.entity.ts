import { ApiProperty } from '@nestjs/swagger';
import {
  IsDate,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { CompletionResponse } from '../../../ai-provider/ai-provider.types';
import { PublicCompletionBatchRequestStatus } from '../../../storage/entities.generated';
import type { CompletionRequestDto } from '../../dto/completion-request.dto';
import { completionBatchRequestStatusValues } from './batch.entity';

export class CompletionBatchItemEntity {
  @ApiProperty({
    description: 'The unique identifier for the workspace (UUID)',
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid',
  })
  @IsUUID('4')
  @IsNotEmpty()
  workspaceId: string;

  @ApiProperty({
    description: 'The unique identifier for the environment (UUID)',
    example: '123e4567-e89b-12d3-a456-426614174001',
    format: 'uuid',
  })
  @IsUUID('4')
  @IsNotEmpty()
  environmentId: string;

  @ApiProperty({
    description: 'The unique identifier for the batch (UUID)',
    example: '223e4567-e89b-12d3-a456-426614174002',
    format: 'uuid',
  })
  @IsUUID('4')
  @IsNotEmpty()
  batchId: string;

  @ApiProperty({
    description: 'The unique identifier for the batch item (UUID)',
    example: '323e4567-e89b-12d3-a456-426614174003',
    format: 'uuid',
  })
  @IsUUID('4')
  @IsNotEmpty()
  itemId: string;

  @ApiProperty({
    description: 'The name of the resource this item references',
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid',
  })
  @IsUUID('4')
  @IsNotEmpty()
  resourceId: string;

  @ApiProperty({
    description: 'The status of the batch item',
    enum: completionBatchRequestStatusValues,
    enumName: 'CompletionBatchRequestStatus',
    example: PublicCompletionBatchRequestStatus.PENDING,
  })
  @IsEnum(PublicCompletionBatchRequestStatus)
  @IsNotEmpty()
  status: PublicCompletionBatchRequestStatus;

  @ApiProperty({
    description:
      'The completion request payload (openai chat completion request payload)',
    type: Object,
    additionalProperties: true,
  })
  @IsNotEmpty()
  request: CompletionRequestDto;

  @ApiProperty({
    description:
      'The response for the batch item (if completed) (openai chat completion response)',
    type: Object,
    additionalProperties: true,
    nullable: true,
    required: false,
  })
  @IsOptional()
  response?: CompletionResponse | null;

  @ApiProperty({
    description: 'The timestamp when the item was completed',
    example: '2024-01-01T10:00:00.000Z',
    nullable: true,
    required: false,
    type: 'string',
    format: 'date-time',
  })
  @IsDate()
  @IsOptional()
  completedAt?: Date | null;

  @ApiProperty({
    description: 'The estimated number of prompt tokens for the batch item',
    example: 100,
  })
  @IsInt()
  @IsNotEmpty()
  estimatedPromptTokens: number;

  @ApiProperty({
    description: 'Number of completion tokens used',
    example: 42,
  })
  @IsInt()
  @IsNotEmpty()
  completionTokens: number;

  @ApiProperty({
    description: 'Number of prompt tokens used',
    example: 15,
  })
  @IsInt()
  @IsNotEmpty()
  promptTokens: number;

  @ApiProperty({
    description: 'Total number of tokens used',
    example: 57,
  })
  @IsInt()
  @IsNotEmpty()
  totalTokens: number;

  @ApiProperty({
    description: 'The error message if the batch item failed',
    example: 'Request failed: Rate limit exceeded.',
    nullable: true,
    required: false,
    type: 'string',
  })
  @IsOptional()
  @IsString()
  errorMessage?: string | null;

  @ApiProperty({
    description: 'The number of times this item has been retried',
    example: 0,
  })
  @IsInt()
  @IsNotEmpty()
  retryCount: number;

  @ApiProperty({
    description: 'The timestamp when the item was created',
    example: '2024-01-01T10:00:00.000Z',
  })
  @IsDate()
  @IsNotEmpty()
  createdAt: Date;
}
