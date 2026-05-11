import { Module } from '@nestjs/common';
import { ModelPricingService } from './model-pricing.service';
import { ModelPricingController } from './model-pricing.controller';
import { PricingSyncService } from './pricing-sync.service';

@Module({
  providers: [ModelPricingService, PricingSyncService],
  controllers: [ModelPricingController],
  exports: [ModelPricingService],
})
export class ModelPricingModule {}
