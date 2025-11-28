import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { EnvironmentRelationDto } from '../../environment/dto/environment.dto';
import { BaseEntity } from '../../common/base-entity';

export class WorkspaceEntity extends BaseEntity {
  @ApiProperty({
    description: 'The unique identifier for the workspace (UUID)',
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid',
  })
  @IsUUID('4')
  @IsNotEmpty()
  workspaceId: string;

  @ApiProperty({
    description: 'The name of the workspace',
    example: 'My Workspace',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    type: 'string',
    nullable: true,
    description: 'The description of the workspace',
    example: 'This is my workspace',
    required: false,
  })
  @IsString()
  @IsOptional()
  description?: string | null;

  @ApiProperty({
    nullable: true,
    description: 'The environments in the workspace',
    required: false,
    isArray: true,
    type: EnvironmentRelationDto,
  })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => EnvironmentRelationDto)
  environments?: EnvironmentRelationDto[];
}
