import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import { CapacityEntity } from '../../capacity/capacity.entity';
import { Type } from 'class-transformer';

/**
 * Update an existing AI connection.
 */
export class UpdateAIConnectionDto {
  @ApiProperty({
    description: 'The name of the AI connection',
    example: 'openai',
  })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({
    description: 'The description of the AI connection',
    example: 'This is my OpenAI connection',
  })
  @IsString()
  @IsOptional()
  description?: string | null;

  @ApiProperty({
    description: 'The provider of the AI connection',
    example: 'openai',
  })
  @IsString()
  @IsOptional()
  provider?: string;

  @ApiProperty({
    description: 'The allowed models of the AI connection',
    example: ['gpt-4o', 'gpt-4o-mini'],
  })
  @IsArray()
  @IsOptional()
  allowedModels?: string[] | null;

  @ApiProperty({
    description: 'The capacities of the AI connection (JSON array)',
    type: [CapacityEntity],
  })
  @IsArray()
  @Type(() => CapacityEntity)
  @IsOptional()
  capacity?: CapacityEntity[] | null;

  @ApiProperty({
    description: 'The configuration of the AI connection (JSON object)',
    type: Object,
  })
  @IsObject()
  @IsOptional()
  config?: Record<string, unknown> | null;
}
