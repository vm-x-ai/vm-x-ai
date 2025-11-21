import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

/**
 * Create a new workspace.
 */
export class CreateWorkspaceDto {
  @ApiProperty({
    description: 'The name of the workspace',
    example: 'My Workspace',
    minLength: 1,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(1, {
    message: 'Name is required.',
  })
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
}
