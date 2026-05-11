import { ApiProperty } from '@nestjs/swagger';

export class MetricDto {
  @ApiProperty({
    description: 'The error rate of the metric',
    example: 0.1,
  })
  errorRate: number;

  @ApiProperty({
    description:
      'The total number of successful requests in the requested window',
    example: 100,
  })
  totalSuccess: number;

  @ApiProperty({
    description: 'The total number of failed requests in the requested window',
    example: 10,
  })
  totalFailed: number;

  @ApiProperty({
    description: 'The total number of requests in the requested window',
    example: 110,
  })
  totalRequests: number;
}
