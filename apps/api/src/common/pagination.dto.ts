import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber } from 'class-validator';

export abstract class PaginationDto<Data> {
  @ApiProperty({
    description: 'The total number of items',
    example: 100,
  })
  @IsNumber()
  @IsNotEmpty()
  total: number;

  @ApiProperty({
    description: 'The page number',
    example: 0,
  })
  @IsNumber()
  @IsNotEmpty()
  pageIndex: number;

  @ApiProperty({
    description: 'The page size',
    example: 10,
  })
  @IsNumber()
  @IsNotEmpty()
  pageSize: number;

  abstract data: Data[];
}
