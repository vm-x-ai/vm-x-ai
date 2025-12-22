import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsNotEmpty, IsString } from 'class-validator';

/**
 * Unassign a role from a user.
 */
export class UnassignRoleDto {
  @ApiProperty({
    description: 'The user IDs to unassign the role from',
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
}
