import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsInt,
  IsDate,
  IsBoolean,
  IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CompletionUsageDto {
  @ApiProperty({
    type: String,
    description: 'Timestamp of the usage event',
    example: '2021-01-01T00:00:00.000Z',
  })
  @Type(() => Date)
  @IsDate()
  timestamp: Date;

  @ApiProperty({
    description: 'Completion input tokens',
    example: 100,
  })
  @IsOptional()
  @IsNumber()
  promptTokens?: number | null = null;

  @ApiProperty({
    description: 'Completion output tokens',
    example: 100,
  })
  @IsOptional()
  @IsNumber()
  completionTokens?: number | null = null;

  @ApiProperty({
    description: 'Total number of tokens',
    example: 200,
  })
  @IsOptional()
  @IsNumber()
  totalTokens?: number | null = null;

  @ApiProperty({
    description: 'Tokens generated per second',
  })
  @IsOptional()
  @IsNumber()
  tokensPerSecond?: number | null = null;

  @ApiProperty({
    description: 'Time to generate the first token (milliseconds)',
    example: 100,
  })
  @IsOptional()
  @IsNumber()
  timeToFirstToken?: number | null = null;

  @ApiProperty({
    description: 'Indicates if the completion request was successful',
    example: false,
  })
  @IsBoolean()
  error?: boolean | null = null;

  @ApiProperty({
    description: 'Total request duration (milliseconds)',
    example: 100,
  })
  @IsOptional()
  @IsNumber()
  requestDuration?: number | null = null;

  @ApiProperty({
    description: 'Time spent in the AI provider API (milliseconds)',
    example: 100,
  })
  @IsOptional()
  @IsNumber()
  providerDuration?: number | null = null;

  @ApiProperty({
    description: 'Time spent in the gate service (milliseconds)',
    example: 100,
  })
  @IsOptional()
  @IsNumber()
  gateDuration?: number | null = null;

  @ApiProperty({
    description: 'Time spent in routing (milliseconds)',
  })
  @IsOptional()
  @IsNumber()
  routingDuration?: number | null = null;

  @ApiProperty({
    description: 'Workspace Identifier',
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid',
  })
  @IsUUID('4')
  @IsNotEmpty()
  workspaceId: string;

  @ApiProperty({
    description: 'Environment Identifier',
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid',
  })
  @IsUUID('4')
  @IsNotEmpty()
  environmentId: string;

  @ApiProperty({
    description: 'AI Connection Identifier',
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID('4')
  connectionId?: string | null = null;

  @ApiProperty({
    description: 'AI Resource Identifier',
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID('4')
  resourceId?: string | null = null;

  @ApiProperty({
    description: 'Provider name',
    example: 'openai',
  })
  @IsOptional()
  @IsString()
  provider?: string | null = null;

  @ApiProperty({
    description: 'Model name',
    example: 'gpt-4o',
  })
  @IsOptional()
  @IsString()
  model?: string | null = null;

  @ApiProperty({
    description: 'Unique identifier for the request',
    example: 'req_123e4567-e89b-12d3-a456-426614174000',
  })
  @IsString()
  @IsNotEmpty()
  requestId: string;

  @ApiProperty({
    description: 'Unique identifier for the message',
    example: 'msg_123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsString()
  messageId?: string | null = null;

  @ApiProperty({
    description: 'Reason for failure, if applicable',
    example: 'Rate limit exceeded',
  })
  @IsOptional()
  @IsString()
  failureReason?: string | null = null;

  @ApiProperty({
    description: 'HTTP status code of the response',
    example: 429,
  })
  @IsInt()
  statusCode: number;

  @ApiProperty({
    description: 'Correlation ID for tracing requests',
    example: 'corr-abc-123',
  })
  @IsOptional()
  @IsString()
  correlationId?: string | null = null;

  @ApiProperty({
    description: 'API key identifier used for the request',
    example: 'api_key_123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID('4')
  apiKeyId?: string | null = null;

  @ApiProperty({
    description: 'Source IP address of the request',
    example: '192.168.1.1',
  })
  @IsString()
  @IsNotEmpty()
  sourceIp: string;

  @ApiProperty({
    description: 'User Identifier',
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID('4')
  userId?: string | null = null;
}
