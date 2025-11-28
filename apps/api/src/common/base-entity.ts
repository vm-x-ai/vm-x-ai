import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsDateString, IsNotEmpty, IsOptional } from "class-validator";
import { UserRelationDto } from "../users/dto/user.dto";

export abstract class BaseEntity {
  @ApiProperty({
    description: 'The date and time the entity was created',
    example: '2021-01-01T00:00:00.000Z',
  })
  @IsDateString()
  @IsNotEmpty()
  createdAt: Date;

  @ApiProperty({
    description: 'The date and time the entity was last updated',
    example: '2021-01-01T00:00:00.000Z',
  })
  @IsDateString()
  @IsNotEmpty()
  updatedAt: Date;

  @ApiProperty({
    description: 'The user who created the entity',
  })
  @IsNotEmpty()
  createdBy: string;

  @ApiProperty({
    nullable: true,
    required: false,
    description: 'The user who created the entity',
  })
  @IsOptional()
  @Type(() => UserRelationDto)
  createdByUser?: UserRelationDto;

  @ApiProperty({
    description: 'The user who last updated the entity',
  })
  @IsNotEmpty()
  updatedBy: string;

  @ApiProperty({
    nullable: true,
    description: 'The user who last updated the entity',
    required: false,
  })
  @IsOptional()
  @Type(() => UserRelationDto)
  updatedByUser?: UserRelationDto;
}
