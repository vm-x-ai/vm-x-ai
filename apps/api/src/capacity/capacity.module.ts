import { Module } from '@nestjs/common';
import { AppCacheModule } from '../cache/cache.module';
import { CapacityService } from './capacity.service';

@Module({
  imports: [AppCacheModule],
  providers: [CapacityService],
  exports: [CapacityService],
})
export class CapacityModule {}
