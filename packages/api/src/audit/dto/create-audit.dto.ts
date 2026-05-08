import { OmitType } from '@nestjs/mapped-types';
import { RequestAuditEntity } from '../entities/audit.entity';

export class CreateRequestAuditDto extends OmitType(RequestAuditEntity, [
  'id',
]) {}
