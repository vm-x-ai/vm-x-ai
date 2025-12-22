import { ApiProperty } from '@nestjs/swagger';
import { ApiKeyRelationDto } from '../../../api-key/dto/relation.dto';
import { CapacityEntity } from '../../../capacity/capacity.entity';
import {
  PublicCompletionBatchRequestStatus,
  PublicCompletionBatchRequestType,
} from '../../../storage/entities.generated';
import { UserRelationDto } from '../../../users/dto/user.dto';
import { CompletionBatchCallbackOptionsDto } from '../dto/callback-options.dto';
import {
  IsArray,
  IsDate,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export const completionBatchRequestTypeValues = Object.values(
  PublicCompletionBatchRequestType
);

export const completionBatchRequestStatusValues = Object.values(
  PublicCompletionBatchRequestStatus
);

export class CompletionBatchEntity {
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
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid',
  })
  @IsUUID('4')
  @IsNotEmpty()
  environmentId: string;

  @ApiProperty({
    description: 'The timestamp of the batch request',
    example: '2021-01-01T00:00:00.000Z',
  })
  @IsDate()
  @IsNotEmpty()
  timestamp: Date;

  @ApiProperty({
    description: 'The unique identifier for the batch request (UUID)',
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid',
  })
  @IsUUID('4')
  @IsNotEmpty()
  batchId: string;

  @ApiProperty({
    description: 'The type of the batch request',
    enumName: 'CompletionBatchRequestType',
    enum: completionBatchRequestTypeValues,
    example: PublicCompletionBatchRequestType.ASYNC,
  })
  @IsEnum(PublicCompletionBatchRequestType)
  @IsNotEmpty()
  type: PublicCompletionBatchRequestType;

  @ApiProperty({
    description: 'The callback options for the batch request',
    type: CompletionBatchCallbackOptionsDto,
    nullable: true,
    required: false,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => CompletionBatchCallbackOptionsDto)
  callbackOptions?: CompletionBatchCallbackOptionsDto | null;

  @ApiProperty({
    description: 'The capacities of the batch request',
    type: [CapacityEntity],
    nullable: true,
    required: false,
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CapacityEntity)
  @IsOptional()
  capacity?: CapacityEntity[] | null;

  @ApiProperty({
    description: 'The number of completed items in the batch request',
    example: 10,
  })
  @IsInt()
  @IsNotEmpty()
  completed: number;

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
  @IsNotEmpty()
  failed: number;

  @ApiProperty({
    description: 'The number of pending items in the batch request',
    example: 10,
  })
  @IsInt()
  @IsNotEmpty()
  pending: number;

  @ApiProperty({
    description: 'The number of running items in the batch request',
    example: 10,
  })
  @IsInt()
  @IsNotEmpty()
  running: number;

  @ApiProperty({
    description: 'The status of the batch request',
    enumName: 'CompletionBatchRequestStatus',
    enum: completionBatchRequestStatusValues,
    example: PublicCompletionBatchRequestStatus.PENDING,
  })
  @IsEnum(PublicCompletionBatchRequestStatus)
  @IsNotEmpty()
  status: PublicCompletionBatchRequestStatus;

  @ApiProperty({
    description:
      'The total estimated number of prompt tokens in the batch request',
    example: 1000,
  })
  @IsInt()
  @IsNotEmpty()
  totalEstimatedPromptTokens: number;

  @ApiProperty({
    description: 'The total number of prompt tokens in the batch request',
    example: 1000,
  })
  @IsInt()
  @IsNotEmpty()
  totalPromptTokens: number;

  @ApiProperty({
    description: 'The total number of completion tokens in the batch request',
    example: 1000,
  })
  @IsInt()
  @IsNotEmpty()
  totalCompletionTokens: number;

  @ApiProperty({
    description: 'The total number of items in the batch request',
    example: 10,
  })
  @IsInt()
  @IsNotEmpty()
  totalItems: number;

  @ApiProperty({
    description: 'The error message of the batch request',
    example: 'An error occurred',
    nullable: true,
    required: false,
    type: 'string',
  })
  @IsString()
  @IsOptional()
  errorMessage?: string | null;

  @ApiProperty({
    description: 'The date and time the batch request was last updated',
    example: '2021-01-01T00:00:00.000Z',
  })
  @IsDate()
  @IsNotEmpty()
  updatedAt: Date;

  @ApiProperty({
    description: 'The date and time the batch request was created',
    example: '2021-01-01T00:00:00.000Z',
  })
  @IsDate()
  @IsNotEmpty()
  createdAt: Date;

  @ApiProperty({
    description:
      'The unique identifier for the API key that created the batch request',
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid',
    nullable: true,
    required: false,
    type: 'string',
  })
  @IsUUID('4')
  @IsOptional()
  createdByApiKeyId?: string | null;

  @ApiProperty({
    description: 'The API key that created the batch request',
    type: ApiKeyRelationDto,
    nullable: true,
    required: false,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ApiKeyRelationDto)
  createdByApiKey?: ApiKeyRelationDto | null;

  @ApiProperty({
    description:
      'The unique identifier for the user that created the batch request',
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid',
    nullable: true,
    required: false,
    type: 'string',
  })
  @IsUUID('4')
  @IsOptional()
  createdByUserId?: string | null;

  @ApiProperty({
    description: 'The user that created the batch request',
    type: UserRelationDto,
    nullable: true,
    required: false,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => UserRelationDto)
  createdByUser?: UserRelationDto | null;
}
