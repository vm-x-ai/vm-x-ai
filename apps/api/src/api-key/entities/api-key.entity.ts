import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CapacityEntity } from '../../capacity/capacity.entity';
import { BaseEntity } from '../../common/base-entity';

export class ApiKeyEntity extends BaseEntity {
  @ApiProperty({
    description: 'The unique identifier for the API key (UUID)',
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid'
  })
  @IsUUID('4')
  @IsNotEmpty()
  apiKeyId: string;

  @ApiProperty({
    description: 'The workspace that the API key is associated with',
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid'
  })
  @IsUUID('4')
  @IsNotEmpty()
  workspaceId: string;

  @ApiProperty({
    description: 'The environment that the API key is associated with',
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid'
  })
  @IsUUID('4')
  @IsNotEmpty()
  environmentId: string;

  @ApiProperty({
    description: 'The name of the API key',
    example: 'My API Key',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    description: 'The description of the API key',
    example: 'This is my API key',
    nullable: true,
    required: false,
    type: 'string',
  })
  @IsString()
  @IsOptional()
  description?: string | null;

  @ApiProperty({
    description: 'Whether the API key is enabled',
    example: true,
  })
  @IsBoolean()
  @IsNotEmpty()
  enabled: boolean;

  @ApiProperty({
    description: 'The resources that the API key is associated with',
    example: ['resource-1', 'resource-2'],
  })
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty()
  resources: string[];

  @ApiProperty({
    description: 'The labels that the API key is associated with',
    example: ['label-1', 'label-2'],
    nullable: true,
    required: false,
    type: 'array',
    items: {
      type: 'string',
      example: 'label-1',
    },
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  labels?: string[] | null;

  @ApiProperty({
    description: 'Whether capacity is enforced for requests to the API key',
    example: false,
  })
  @IsBoolean()
  @IsNotEmpty()
  enforceCapacity: boolean;

  @ApiProperty({
    description: 'The capacities of the API key (JSON array)',
    type: [CapacityEntity],
    nullable: true,
    required: false,
  })
  @IsArray()
  @Type(() => CapacityEntity)
  @IsOptional()
  capacity?: CapacityEntity[] | null;

  @ApiProperty({
    description: 'The masked key of the API key',
    example: 'abc123********',
  })
  @IsString()
  @IsNotEmpty()
  maskedKey: string;
}

export class FullApiKeyEntity extends ApiKeyEntity {
  @ApiProperty({
    description: 'The hash of the API key',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsString()
  @IsNotEmpty()
  hash: string;
}
