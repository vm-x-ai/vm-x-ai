import { PartialType } from '@nestjs/mapped-types';
import { CreateModelPricingDto } from './create-model-pricing.dto';

export class UpdateModelPricingDto extends PartialType(CreateModelPricingDto) {}
