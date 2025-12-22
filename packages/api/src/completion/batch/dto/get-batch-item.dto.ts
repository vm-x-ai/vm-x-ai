import { IsNotEmpty, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GetBatchItemDto {
  @ApiProperty({
    description: 'The workspace ID to get the batch for',
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid',
  })
  @IsUUID('4')
  @IsNotEmpty()
  workspaceId: string;

  @ApiProperty({
    description: 'The environment ID to get the batch for',
    example: '123e4567-e89b-12d3-a456-426614174001',
    format: 'uuid',
  })
  @IsUUID('4')
  @IsNotEmpty()
  environmentId: string;

  @ApiProperty({
    description: 'The batch ID to get the batch for',
    example: '123e4567-e89b-12d3-a456-426614174002',
    format: 'uuid',
  })
  @IsUUID('4')
  @IsNotEmpty()
  batchId: string;

  @ApiProperty({
    description: 'The item ID to get the batch item for',
    example: '123e4567-e89b-12d3-a456-426614174003',
    format: 'uuid',
  })
  @IsUUID('4')
  @IsNotEmpty()
  itemId: string;
}
