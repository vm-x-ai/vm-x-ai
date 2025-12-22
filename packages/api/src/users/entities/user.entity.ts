import { ApiProperty } from '@nestjs/swagger';
import {
  PublicProviderType,
  PublicUserState,
} from '../../storage/entities.generated';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class UserEntity {
  @ApiProperty({
    description: 'The unique identifier for the user (UUID)',
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid',
  })
  @IsUUID('4')
  @IsNotEmpty()
  id: string;

  @ApiProperty({
    description: 'The name of the user',
    example: 'John Doe',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    description: 'The first name of the user',
    example: 'John',
  })
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @ApiProperty({
    description: 'The last name of the user',
    example: 'Doe',
  })
  @IsString()
  @IsNotEmpty()
  lastName: string;

  @ApiProperty({
    description: 'The username of the user, by default it is the email address',
    example: 'john.doe',
  })
  @IsString()
  @IsNotEmpty()
  username: string;

  @ApiProperty({
    description: 'The email address of the user',
    example: 'john.doe@example.com',
  })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({
    description: 'Whether the email address of the user has been verified',
    example: true,
  })
  @IsBoolean()
  @IsNotEmpty()
  emailVerified: boolean;

  @ApiProperty({
    type: 'string',
    required: false,
    nullable: true,
    description: "The URL of the user's profile picture",
    example: 'https://example.com/profile.jpg',
  })
  @IsString()
  @IsOptional()
  pictureUrl?: string | null;

  @ApiProperty({
    description: 'The state of the user',
    enum: PublicUserState,
    example: PublicUserState.CHANGE_PASSWORD,
    enumName: 'UserState',
  })
  @IsEnum(PublicUserState)
  @IsNotEmpty()
  state: PublicUserState;

  @ApiProperty({
    description: 'The type of provider used by the user',
    enum: PublicProviderType,
    example: PublicProviderType.LOCAL,
  })
  @IsEnum(PublicProviderType)
  @IsNotEmpty()
  providerType: PublicProviderType;

  @ApiProperty({
    description: 'The provider identifier for the user',
    example: ['google', 'local'],
  })
  @IsString()
  @IsNotEmpty()
  providerId: string;

  @ApiProperty({
    type: Object,
    additionalProperties: true,
    nullable: true,
    description: 'The provider specific metadata for the user (e.g claims)',
    required: false,
  })
  @IsObject()
  @IsOptional()
  providerMetadata?: unknown | null;

  @ApiProperty({
    description: 'The date and time the user was created',
    example: '2021-01-01T00:00:00.000Z',
  })
  @IsDateString()
  @IsNotEmpty()
  createdAt: Date;

  @ApiProperty({
    description: 'The date and time the user was last updated',
    example: '2021-01-01T00:00:00.000Z',
  })
  @IsDateString()
  @IsNotEmpty()
  updatedAt: Date;

  @ApiProperty({
    description: 'The user who created the user',
    example: '123e4567-e89b-12d3-a456-426614174000',
    nullable: true,
    required: false,
    type: String,
  })
  @IsUUID('4')
  @IsNotEmpty()
  createdBy?: string | null;

  @ApiProperty({
    description: 'The user who last updated the user',
    example: '123e4567-e89b-12d3-a456-426614174000',
    nullable: true,
    required: false,
    type: String,
  })
  @IsUUID('4')
  @IsNotEmpty()
  updatedBy?: string | null;
}

export class FullUserEntity extends UserEntity {
  @ApiProperty({
    description: 'The password hash of the user',
    example: 'Argon2 hash',
  })
  @IsString()
  @IsOptional()
  passwordHash?: string | null;
}
