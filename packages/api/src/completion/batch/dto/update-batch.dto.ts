import { ApiProperty } from '@nestjs/swagger';
import { IsDate, IsEnum, IsInt, IsOptional, IsString } from 'class-validator';
import { PublicCompletionBatchRequestStatus } from '../../../storage/entities.generated';
import { completionBatchRequestStatusValues } from '../entity/batch.entity';

export class UpdateCompletionBatchDto {
  @ApiProperty({
    description: 'The number of completed items in the batch request',
    example: 10,
  })
  @IsInt()
  @IsOptional()
  completed?: number;

  @ApiProperty({
    description: 'The date and time the batch request was completed',
    example: '2021-01-01T00:00:00.000Z',
    nullable: true,
    required: false,
    type: 'string',
    format: 'date-time',
  })
  @IsDate()
  @IsOptional()
  completedAt?: Date | null;

  @ApiProperty({
    description: 'The number of failed items in the batch request',
    example: 10,
  })
  @IsInt()
  @IsOptional()
  failed?: number;

  @ApiProperty({
    description: 'The number of pending items in the batch request',
    example: 10,
  })
  @IsInt()
  @IsOptional()
  pending?: number;

  @ApiProperty({
    description: 'The number of running items in the batch request',
    example: 10,
  })
  @IsInt()
  @IsOptional()
  running?: number;

  @ApiProperty({
    description: 'The status of the batch request',
    enumName: 'CompletionBatchRequestStatus',
    enum: completionBatchRequestStatusValues,
    example: PublicCompletionBatchRequestStatus.PENDING,
  })
  @IsEnum(PublicCompletionBatchRequestStatus)
  @IsOptional()
  status?: PublicCompletionBatchRequestStatus;

  @ApiProperty({
    description: 'The total number of prompt tokens in the batch request',
    example: 1000,
  })
  @IsInt()
  @IsOptional()
  totalPromptTokens?: number;

  @ApiProperty({
    description: 'The total number of completion tokens in the batch request',
    example: 1000,
  })
  @IsInt()
  @IsOptional()
  totalCompletionTokens?: number;

  @ApiProperty({
    description: 'The total number of items in the batch request',
    example: 10,
  })
  @IsInt()
  @IsOptional()
  totalItems?: number;

  @ApiProperty({
    description: 'The error message of the batch request',
    example: 'An error occurred',
  })
  @IsString()
  @IsOptional()
  errorMessage?: string | null;
}
