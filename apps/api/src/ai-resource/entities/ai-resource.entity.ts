import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';
import { CapacityEntity } from '../../capacity/capacity.entity';
import { AIResourceModelConfigEntity } from '../common/model.entity';
import { AIResourceModelRoutingEntity } from '../common/routing.entity';
import { BaseEntity } from '../../common/base-entity';

export class AIResourceEntity extends BaseEntity {
  @ApiProperty({
    description: 'Resource unique identifier',
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid'
  })
  @IsUUID('4')
  @IsNotEmpty()
  resourceId: string;

  @ApiProperty({
    description: 'Workspace ID associated with the resource',
    example: 'workspace-uuid-string',
    format: 'uuid'
  })
  @IsUUID('4')
  workspaceId: string;

  @ApiProperty({
    description: 'Environment ID associated with the resource',
    example: 'environment-uuid-string',
    format: 'uuid'
  })
  @IsUUID('4')
  environmentId: string;

  @ApiProperty({
    description: 'Name of the AI resource',
    example: 'My GPT-4O Resource',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({
    description: 'Description of the AI resource',
    example: 'A high throughput GPT-4O endpoint for production',
    nullable: true,
    required: false,
    type: 'string',
  })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiProperty({
    type: AIResourceModelConfigEntity,
    description: 'Primary model configuration for the resource',
  })
  @ValidateNested()
  @Type(() => AIResourceModelConfigEntity)
  model: AIResourceModelConfigEntity;

  @ApiProperty({
    description: 'Whether fallback models are used if primary fails',
    example: false,
  })
  @IsBoolean()
  useFallback: boolean;

  @ApiPropertyOptional({
    type: [AIResourceModelConfigEntity],
    description: 'List of fallback model configurations',
    nullable: true,
    required: false,
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AIResourceModelConfigEntity)
  fallbackModels?: AIResourceModelConfigEntity[] | null;

  @ApiPropertyOptional({
    type: [AIResourceModelConfigEntity],
    description: 'List of secondary (non-fallback) models for A/B/ensemble use',
    nullable: true,
    required: false,
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AIResourceModelConfigEntity)
  secondaryModels?: AIResourceModelConfigEntity[] | null;

  @ApiPropertyOptional({
    type: AIResourceModelRoutingEntity,
    description: 'Routing rules for this resource',
    nullable: true,
    required: false,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => AIResourceModelRoutingEntity)
  routing?: AIResourceModelRoutingEntity | null;

  @ApiPropertyOptional({
    type: [CapacityEntity],
    description: 'Capacity configuration entries for rate limiting',
    nullable: true,
    required: false,
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
  enforceCapacity: boolean;
}
