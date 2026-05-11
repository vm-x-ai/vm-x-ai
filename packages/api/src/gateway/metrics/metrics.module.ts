import { Module } from '@nestjs/common';
import { CompletionMetricsController } from './metrics.controller';
import { CompletionMetricsService } from './metrics.service';

@Module({
  imports: [],
  controllers: [CompletionMetricsController],
  providers: [CompletionMetricsService],
  exports: [CompletionMetricsService],
})
export class CompletionMetricsModule {}
