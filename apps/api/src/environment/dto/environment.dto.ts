import { ApiProperty, OmitType } from '@nestjs/swagger';
import { EnvironmentEntity } from '../entities/environment.entity';
import { IsDateString, IsNotEmpty } from 'class-validator';

export class EnvironmentRelationDto extends OmitType(EnvironmentEntity, [
  'createdAt',
  'updatedAt',
]) {
  @ApiProperty({
    description: 'The date and time the environment was created',
    example: '2021-01-01T00:00:00.000Z',
    format: 'date-time',
  })
  @IsDateString()
  @IsNotEmpty()
  createdAt: string;

  @ApiProperty({
    description: 'The date and time the environment was last updated',
    example: '2021-01-01T00:00:00.000Z',
    format: 'date-time',
  })
  @IsDateString()
  @IsNotEmpty()
  updatedAt: string;
}
