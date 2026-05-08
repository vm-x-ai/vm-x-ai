import { Module } from '@nestjs/common';
import { CostService } from './cost.service';
import { ModelPricingModule } from '../../model-pricing/model-pricing.module';

@Module({
  imports: [ModelPricingModule],
  providers: [CostService],
  exports: [CostService],
})
export class CostModule {}
