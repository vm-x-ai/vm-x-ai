import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { PublicWorkspaceUserRole } from '../../storage/entities.generated';

export class AssignWorkspaceUsersDto {
  @ApiProperty({
    description: 'The user IDs to assign to the workspace',
    example: [
      '123e4567-e89b-12d3-a456-426614174000',
      '456e7890-1234-5678-9012-345678901234',
    ],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty()
  userIds: string[];

  @ApiProperty({
    description: 'The role to assign to the users',
    enumName: 'WorkspaceUserRole',
    example: PublicWorkspaceUserRole.OWNER,
    enum: PublicWorkspaceUserRole,
  })
  @IsEnum(PublicWorkspaceUserRole)
  @IsNotEmpty()
  role: PublicWorkspaceUserRole;
}
