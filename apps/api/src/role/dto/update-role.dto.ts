import { PartialType } from '@nestjs/swagger';
import { CreateRoleDto } from './create-role.dto';

/**
 * Update a role.
 */
export class UpdateRoleDto extends PartialType(CreateRoleDto) {}
