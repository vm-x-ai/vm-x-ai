import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsDate, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';
import { CapacityEntity } from '../../capacity/capacity.entity';
import { UserRelationDto } from '../../users/dto/user.dto';
import { AIResourceModelConfigEntity } from '../common/model.entity';
import { AIResourceModelRoutingEntity } from '../common/routing.entity';

export class AIResourceEntity {
  @ApiProperty({
    description: 'Resource unique identifier',
    example: 'resource-id-string',
  })
  @IsString()
  resource: string;

  @ApiProperty({
    description: 'Workspace ID associated with the resource',
    example: 'workspace-uuid-string',
  })
  @IsUUID('4')
  workspaceId: string;

  @ApiProperty({
    description: 'Environment ID associated with the resource',
    example: 'environment-uuid-string',
  })
  @IsUUID('4')
  environmentId: string;

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
  enforceCapacity: boolean;

  @ApiProperty({
    description: 'Timestamp when the resource was created',
    example: '2024-05-01T12:34:56.789Z',
  })
  @IsDate()
  createdAt: Date;

  @ApiProperty({
    description: 'Timestamp when the resource was last updated',
    example: '2024-06-01T12:34:56.789Z',
  })
  @IsDate()
  updatedAt: Date;

  @ApiProperty({
    description: 'User ID who created the resource',
    example: 'user-uuid-string',
  })
  @IsUUID('4')
  createdBy: string;

  @ApiPropertyOptional({
    type: UserRelationDto,
    description: 'User details of who created the resource',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => UserRelationDto)
  createdByUser?: UserRelationDto;

  @ApiProperty({
    description: 'User ID who last updated the resource',
    example: 'user-uuid-string',
  })
  @IsUUID('4')
  updatedBy: string;

  @ApiPropertyOptional({
    type: UserRelationDto,
    description: 'User details of who last updated the resource',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => UserRelationDto)
  updatedByUser?: UserRelationDto;
}
