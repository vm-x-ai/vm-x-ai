import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsNotEmpty, IsString, IsUUID } from "class-validator";

export class JwtPayloadDto {
  @ApiProperty({
    description: 'The user ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID('4')
  @IsNotEmpty()
  sub: string;

  @ApiProperty({
    description: 'The email address of the user',
    example: 'john.doe@example.com',
  })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({
    description: 'The username of the user or the email address',
    example: 'john.doe',
  })
  @IsString()
  @IsNotEmpty()
  username: string;
}