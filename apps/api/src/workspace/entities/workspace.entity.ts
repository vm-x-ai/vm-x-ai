import { ApiProperty } from '@nestjs/swagger';
import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { UserRelationDto } from '../../users/dto/user.dto';
import { Type } from 'class-transformer';
import { EnvironmentRelationDto } from '../../environment/dto/environment.dto';

export class WorkspaceEntity {
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
    nullable: true,
    required: false,
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
    nullable: true,
    description: 'The user who last updated the workspace',
    required: false,
  })
  @IsOptional()
  @Type(() => UserRelationDto)
  updatedByUser?: UserRelationDto;

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
