import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsNotEmpty, IsString } from 'class-validator';

export class UnassignWorkspaceUsersDto {
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
}
