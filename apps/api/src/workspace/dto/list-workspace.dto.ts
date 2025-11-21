import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class ListWorkspaceDto {
  @ApiProperty({
    description: 'The user ID to list workspaces for',
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid',
  })
  @IsUUID('4')
  @IsOptional()
  userId?: string | null;

  @ApiProperty({
    description: 'Whether to include users in the response',
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  includesUsers?: boolean | null;

  @ApiProperty({
    description: 'Whether to include environments in the response',
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  includesEnvironments?: boolean | null;
}
