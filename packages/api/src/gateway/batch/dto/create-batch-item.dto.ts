import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsUUID } from 'class-validator';
import type { CompletionRequestDto } from '../../dto/completion-request.dto';

export class CreateCompletionBatchItemDto {
  @ApiProperty({
    description: 'The name of the resource this item references',
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid',
  })
  @IsUUID('4')
  @IsNotEmpty()
  resourceId: string;

  @ApiProperty({
    description:
      'The completion request payload (openai chat completion request payload)',
    type: Object,
    additionalProperties: true,
  })
  @IsNotEmpty()
  request: CompletionRequestDto;
}

export class CreateCompletionBatchItemWithEstimatedPromptTokensDto extends CreateCompletionBatchItemDto {
  @ApiProperty({
    description: 'The estimated number of prompt tokens for the batch item',
    example: 100,
  })
  @IsInt()
  @IsNotEmpty()
  estimatedPromptTokens: number;
}
