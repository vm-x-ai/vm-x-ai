import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class AIResourceModelConfigEntity {
  @ApiProperty({
    description: 'The provider of the AI resource model',
    example: 'openai',
  })
  @IsString()
  @IsNotEmpty()
  provider: string;

  @ApiProperty({
    description: 'The model of the AI resource model',
    example: 'gpt-4o',
  })
  @IsString()
  @IsNotEmpty()
  model: string;

  @ApiProperty({
    description: 'The AI connection ID of the AI resource model',
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid',
  })
  @IsUUID('4')
  @IsNotEmpty()
  connectionId: string;
}
