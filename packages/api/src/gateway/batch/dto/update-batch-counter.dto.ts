import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional } from 'class-validator';

export class UpdateCompletionBatchCountersDto {
  @ApiProperty({
    description: 'The number of completed items in the batch request',
    example: 10,
  })
  @IsInt()
  @IsOptional()
  completed?: number;

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
    description: 'The total number of prompt tokens in the batch request',
    example: 1000,
  })
  @IsInt()
  @IsOptional()
  totalPromptTokens?: number;

  @ApiProperty({
    description: 'The total number of output tokens in the batch request',
    example: 1000,
  })
  @IsInt()
  @IsOptional()
  totalOutputTokens?: number;
}
