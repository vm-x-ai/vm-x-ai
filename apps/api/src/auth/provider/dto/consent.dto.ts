import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty } from 'class-validator';

export class ConsentDto {
  @ApiProperty({
    description: 'The consent value',
    enum: ['yes', 'no'],
  })
  @IsEnum(['yes', 'no'])
  @IsNotEmpty()
  consent: 'yes' | 'no';
}
