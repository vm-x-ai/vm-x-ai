import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsNotEmpty, IsOptional, IsUUID } from 'class-validator';
import { UserRelationDto } from '../../users/dto/user.dto';
import { Type } from 'class-transformer';

export class UserRoleEntity {
  @ApiProperty({
    description: 'The unique identifier for the role (UUID)',
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid',
  })
  @IsUUID('4')
  @IsNotEmpty()
  roleId: string;

  @ApiProperty({
    description: 'The user who is assigned the role',
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid',
  })
  @IsUUID('4')
  @IsNotEmpty()
  userId: string;

  @ApiProperty({
    description: 'The date and time the role was assigned',
    example: '2021-01-01T00:00:00.000Z',
  })
  @IsDateString()
  @IsNotEmpty()
  assignedAt: Date;

  @ApiProperty({
    description: 'The user who assigned the role',
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid',
  })
  @IsUUID('4')
  @IsNotEmpty()
  assignedBy: string;

  @ApiProperty({
    nullable: true,
    description: 'The user who assigned the role',
    required: false,
  })
  @IsOptional()
  @Type(() => UserRelationDto)
  assignedByUser?: UserRelationDto;
}
