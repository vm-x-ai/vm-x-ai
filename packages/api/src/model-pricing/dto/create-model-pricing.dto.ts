import { OmitType } from '@nestjs/mapped-types';
import { ModelPricingEntity } from '../entities/model-pricing.entity';

export class CreateModelPricingDto extends OmitType(ModelPricingEntity, [
  'pricingId',
  'source',
  'createdAt',
  'updatedAt',
  'createdBy',
  'updatedBy',
] as const) {}
