import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { BaseEntity } from '../../common/base-entity';
import { $enum } from 'ts-enum-util';
import { Type } from 'class-transformer';

export enum RolePolicyEffect {
  ALLOW = 'allow',
  DENY = 'deny',
}

export const RolePolicyEffectValues = $enum(RolePolicyEffect).getValues();

export class RolePolicyStatement {
  @ApiProperty({
    description: 'The effect of the statement',
    example: RolePolicyEffect.ALLOW,
    enum: RolePolicyEffectValues,
    enumName: 'RolePolicyEffect',
  })
  @IsEnum(RolePolicyEffect)
  effect: RolePolicyEffect;

  @ApiProperty({
    description: 'The actions of the statement',
    example: ['user:list', 'user:create', 'user:update', 'user:delete'],
  })
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty()
  actions: string[];

  @ApiProperty({
    description: 'The resources of the statement',
    example: ['*'],
  })
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty()
  resources: string[];
}

export class RolePolicy {
  @ApiProperty({
    description: 'The statements of the policy',
    example: [
      {
        effect: RolePolicyEffect.ALLOW,
        actions: ['user:list', 'user:create', 'user:update', 'user:delete'],
        resources: ['*'],
      },
    ],
    type: [RolePolicyStatement],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RolePolicyStatement)
  @IsNotEmpty()
  statements: RolePolicyStatement[];
}

export class RoleEntity extends BaseEntity {
  @ApiProperty({
    description: 'The unique identifier for the role (UUID)',
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid',
  })
  @IsUUID('4')
  @IsNotEmpty()
  roleId: string;

  @ApiProperty({
    description: 'The name of the role',
    example: 'Admin',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    description: 'The description of the role',
    example: 'Admin role',
  })
  @IsString()
  @IsOptional()
  description?: string | null;

  @ApiProperty({
    description: 'The policy of the role',
    type: RolePolicy,
    example: {
      statements: [
        {
          effect: RolePolicyEffect.ALLOW,
          actions: ['user:list', 'user:create', 'user:update', 'user:delete'],
          resources: ['*'],
        },
      ],
    },
  })
  @IsObject()
  @IsNotEmpty()
  policy: RolePolicy;
}
