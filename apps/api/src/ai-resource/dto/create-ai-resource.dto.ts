import { ApiProperty, OmitType } from '@nestjs/swagger';
import { AIResourceEntity } from '../entities/ai-resource.entity';
import { IsOptional } from 'class-validator';

/**
 * Create a new AI resource.
 */
export class CreateAIResourceDto extends OmitType(AIResourceEntity, [
  'workspaceId',
  'environmentId',
  'createdAt',
  'updatedAt',
  'createdBy',
  'createdByUser',
  'updatedBy',
  'updatedByUser',
]) {
  @ApiProperty({
    description: 'The API keys to assign to the AI resource',
    example: ['api-key-1', 'api-key-2'],
    type: 'array',
    items: {
      type: 'string',
      example: 'api-key-1',
    },
    required: false,
    nullable: true,
  })
  @IsOptional()
  assignApiKeys?: string[] | null;
}
