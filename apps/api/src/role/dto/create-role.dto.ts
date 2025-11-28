import { OmitType } from '@nestjs/swagger';
import { RoleEntity } from '../entities/role.entity';

/**
 * Create a new role.
 */
export class CreateRoleDto extends OmitType(RoleEntity, [
  'roleId',
  'createdAt',
  'updatedAt',
  'createdBy',
  'createdByUser',
  'updatedBy',
  'updatedByUser',
]) {}
