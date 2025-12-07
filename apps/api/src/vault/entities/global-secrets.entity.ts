import { IsDateString, IsNotEmpty, IsOptional, IsString, IsUUID } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class GlobalSecretEntity {
  @ApiProperty({
    description: 'The unique identifier for the global secret (UUID)',
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid'
  })
  @IsUUID('4')
  @IsNotEmpty()
  secretId: string;

  @ApiProperty({
    description: 'The name of the global secret',
    example: 'My Global Secret',
  })
  @IsString()
  @IsNotEmpty()
  name: string; 

  @ApiProperty({
    description: 'The description of the global secret',
    example: 'This is my global secret',
    nullable: true,
    required: false,
    type: String,
  })
  @IsString()
  @IsOptional()
  description?: string | null

  @ApiProperty({
    description: 'The value of the global secret',
    example: 'my-secret-value',
  })
  @IsString()
  @IsNotEmpty()
  value: string;

  @ApiProperty({
    description: 'The date and time the global secret was created',
    example: '2021-01-01T00:00:00.000Z',
    format: 'date-time'
  })
  @IsDateString()
  @IsNotEmpty()
  createdAt: Date;
}
