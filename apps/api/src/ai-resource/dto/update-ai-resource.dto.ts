import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsOptional, IsString, ValidateNested } from 'class-validator';
import { CapacityEntity } from '../../capacity/capacity.entity';
import { AIResourceModelConfigEntity } from '../common/model.entity';
import { AIResourceModelRoutingEntity } from '../common/routing.entity';

/**
 * Update an existing AI resource.
 */
export class UpdateAIResourceDto {
  @ApiPropertyOptional({
    description: 'Description of the AI resource',
    example: 'A high throughput GPT-4O endpoint for production',
  })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiProperty({
    type: AIResourceModelConfigEntity,
    description: 'Primary model configuration for the resource',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => AIResourceModelConfigEntity)
  model?: AIResourceModelConfigEntity;

  @ApiProperty({
    description: 'Whether fallback models are used if primary fails',
    example: false,
  })
  @IsBoolean()
  @IsOptional()
  useFallback?: boolean;

  @ApiPropertyOptional({
    type: [AIResourceModelConfigEntity],
    description: 'List of fallback model configurations',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AIResourceModelConfigEntity)
  fallbackModels?: AIResourceModelConfigEntity[] | null;

  @ApiPropertyOptional({
    type: [AIResourceModelConfigEntity],
    description: 'List of secondary (non-fallback) models for A/B/ensemble use',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AIResourceModelConfigEntity)
  secondaryModels?: AIResourceModelConfigEntity[] | null;

  @ApiPropertyOptional({
    type: AIResourceModelRoutingEntity,
    description: 'Routing rules for this resource',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => AIResourceModelRoutingEntity)
  routing?: AIResourceModelRoutingEntity | null;

  @ApiPropertyOptional({
    type: [CapacityEntity],
    description: 'Capacity configuration entries for rate limiting',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CapacityEntity)
  capacity?: CapacityEntity[] | null;

  @ApiProperty({
    description: 'Whether capacity is enforced for requests to this resource',
    example: false,
  })
  @IsBoolean()
  @IsOptional()
  enforceCapacity?: boolean;
}
