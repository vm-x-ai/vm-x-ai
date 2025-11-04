import { IsNotEmpty, IsString } from 'class-validator';
import { ApiKeyEntity } from '../entities/api-key.entity';
import { ApiProperty } from '@nestjs/swagger';

export class CreatedApiKeyDto extends ApiKeyEntity {
  @ApiProperty({
    description:
      'The full API key value, this is only returned once during creation',
    example: 'abc123',
  })
  @IsString()
  @IsNotEmpty()
  apiKeyValue: string;
}
