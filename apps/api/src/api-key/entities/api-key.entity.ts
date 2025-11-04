import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { UserRelationDto } from '../../users/dto/user.dto';
import { Type } from 'class-transformer';
import { CapacityEntity } from '../../capacity/capacity.entity';

export class ApiKeyEntity {
  @ApiProperty({
    description: 'The unique identifier for the API key (UUID)',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID('4')
  @IsNotEmpty()
  apiKeyId: string;

  @ApiProperty({
    description: 'The workspace that the API key is associated with',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID('4')
  @IsNotEmpty()
  workspaceId: string;

  @ApiProperty({
    description: 'The environment that the API key is associated with',
    example: '123e4567-e89b-12d3-a456-426614174000',
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

  @ApiProperty({
    description: 'The date and time the API key was last used',
    example: '2021-01-01T00:00:00.000Z',
  })
  @IsDateString()
  @IsOptional()
  lastUsedAt?: Date | null;

  @ApiProperty({
    description: 'The IP address of the last request to the API key',
    example: '127.0.0.1',
  })
  @IsString()
  @IsOptional()
  lastUsedIp?: string | null;

  @ApiProperty({
    description: 'The date and time the API key was created',
    example: '2021-01-01T00:00:00.000Z',
  })
  @IsDateString()
  @IsNotEmpty()
  createdAt: Date;

  @ApiProperty({
    description: 'The date and time the API key was last updated',
    example: '2021-01-01T00:00:00.000Z',
  })
  @IsDateString()
  @IsNotEmpty()
  updatedAt: Date;

  @ApiProperty({
    description: 'The user who created the API key',
  })
  @IsNotEmpty()
  createdBy: string;

  @ApiProperty({
    description: 'The user who created the API key',
  })
  @IsOptional()
  @Type(() => UserRelationDto)
  createdByUser?: UserRelationDto;

  @ApiProperty({
    description: 'The user who last updated the API key',
  })
  @IsNotEmpty()
  updatedBy: string;

  @ApiProperty({
    description: 'The user who last updated the API key',
  })
  @IsOptional()
  @Type(() => UserRelationDto)
  updatedByUser?: UserRelationDto;
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
