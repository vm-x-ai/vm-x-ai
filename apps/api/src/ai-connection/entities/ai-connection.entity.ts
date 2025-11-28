import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  CapacityEntity,
  DiscoveredCapacityEntity,
} from '../../capacity/capacity.entity';
import { BaseEntity } from '../../common/base-entity';

export class AIConnectionEntity<
  T extends Record<string, unknown> = Record<string, unknown>
> extends BaseEntity {
  @ApiProperty({
    description: 'The unique identifier for the AI connection (UUID)',
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid'
  })
  @IsUUID('4')
  @IsNotEmpty()
  connectionId: string;

  @ApiProperty({
    description: 'The workspace that the AI connection is associated with',
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid'
  })
  @IsUUID('4')
  @IsNotEmpty()
  workspaceId: string;

  @ApiProperty({
    description: 'The environment that the AI connection is associated with',
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid'
  })
  @IsUUID('4')
  @IsNotEmpty()
  environmentId: string;

  @ApiProperty({
    description: 'The name of the AI connection',
    example: 'openai',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    type: 'string',
    required: false,
    nullable: true,
    description: 'The description of the AI connection',
    example: 'OpenAI default connection',
  })
  @IsString()
  @IsOptional()
  description?: string | null;

  @ApiProperty({
    description: 'The provider of the AI connection',
    example: 'openai',
  })
  @IsString()
  @IsNotEmpty()
  provider: string;

  @ApiProperty({
    type: 'array',
    items: {
      type: 'string',
      example: 'gpt-4o',
    },
    required: false,
    nullable: true,
    description: 'The allowed models of the AI connection',
    example: ['gpt-4o', 'gpt-4o-mini'],
  })
  @IsArray()
  @IsOptional()
  allowedModels?: string[] | null;

  @ApiProperty({
    nullable: true,
    required: false,
    description: 'The capacities of the AI connection (JSON array)',
    type: [CapacityEntity],
  })
  @IsArray()
  @Type(() => CapacityEntity)
  @IsOptional()
  capacity?: CapacityEntity[] | null;

  @ApiProperty({
    nullable: true,
    required: false,
    description:
      'The automatically discovered capacity of the AI connection (JSON object)',
    type: DiscoveredCapacityEntity,
  })
  @IsObject()
  @IsOptional()
  @Type(() => DiscoveredCapacityEntity)
  discoveredCapacity?: DiscoveredCapacityEntity | null;

  @ApiProperty({
    nullable: true,
    required: false,
    description: 'The configuration of the AI connection (JSON object)',
    type: Object,
  })
  @IsObject()
  @IsOptional()
  config?: T | null;
}
