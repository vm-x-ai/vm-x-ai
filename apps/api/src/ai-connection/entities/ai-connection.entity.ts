import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { UserRelationDto } from '../../users/dto/user.dto';
import { Type } from 'class-transformer';
import {
  CapacityEntity,
  DiscoveredCapacityEntity,
} from '../../common/capacity.entity';

export class AIConnectionEntity<
  T extends Record<string, unknown> = Record<string, unknown>
> {
  @ApiProperty({
    description: 'The unique identifier for the AI connection (UUID)',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID('4')
  @IsNotEmpty()
  connectionId: string;

  @ApiProperty({
    description: 'The workspace that the AI connection is associated with',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID('4')
  @IsNotEmpty()
  workspaceId: string;

  @ApiProperty({
    description: 'The environment that the AI connection is associated with',
    example: '123e4567-e89b-12d3-a456-426614174000',
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
    description:
      'The automatically discovered capacity of the AI connection (JSON object)',
    type: DiscoveredCapacityEntity,
  })
  @IsObject()
  @IsOptional()
  @Type(() => DiscoveredCapacityEntity)
  discoveredCapacity?: DiscoveredCapacityEntity | null;

  @ApiProperty({
    description: 'The configuration of the AI connection (JSON object)',
    type: Object,
  })
  @IsObject()
  @IsOptional()
  config?: T | null;

  @ApiProperty({
    description: 'The date and time the workspace was created',
    example: '2021-01-01T00:00:00.000Z',
  })
  @IsDateString()
  @IsNotEmpty()
  createdAt: Date;

  @ApiProperty({
    description: 'The date and time the workspace was last updated',
    example: '2021-01-01T00:00:00.000Z',
  })
  @IsDateString()
  @IsNotEmpty()
  updatedAt: Date;

  @ApiProperty({
    description: 'The user who created the workspace',
  })
  @IsNotEmpty()
  createdBy: string;

  @ApiProperty({
    description: 'The user who created the workspace',
  })
  @IsOptional()
  @Type(() => UserRelationDto)
  createdByUser?: UserRelationDto;

  @ApiProperty({
    description: 'The user who last updated the workspace',
  })
  @IsNotEmpty()
  updatedBy: string;

  @ApiProperty({
    description: 'The user who last updated the workspace',
  })
  @IsOptional()
  @Type(() => UserRelationDto)
  updatedByUser?: UserRelationDto;
}
