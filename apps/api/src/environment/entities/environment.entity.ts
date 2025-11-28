import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { BaseEntity } from '../../common/base-entity';

export class EnvironmentEntity extends BaseEntity {
  @ApiProperty({
    description: 'The unique identifier for the environment (UUID)',
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid'
  })
  @IsUUID('4')
  @IsNotEmpty()
  environmentId: string;

  @ApiProperty({
    description: 'The workspace that the environment is associated with',
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid'
  })
  @IsUUID('4')
  @IsNotEmpty()
  workspaceId: string;

  @ApiProperty({
    description: 'The name of the environment',
    example: 'production',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    type: 'string',
    required: false,
    nullable: true,
    description: 'The description of the environment',
    example: 'This is my production environment',
  })
  @IsString()
  @IsOptional()
  description?: string | null;
}
