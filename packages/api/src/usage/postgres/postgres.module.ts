import { Module } from '@nestjs/common';
import { PostgresRequestUsageProvider } from './postgres.provider';
import { REQUEST_USAGE_PROVIDER } from '../usage.types';
import { DatabaseModule } from '../../storage/database.module';

@Module({
  imports: [DatabaseModule],
  providers: [
    PostgresRequestUsageProvider,
    {
      provide: REQUEST_USAGE_PROVIDER,
      useExisting: PostgresRequestUsageProvider,
    },
  ],
  exports: [REQUEST_USAGE_PROVIDER],
})
export class PostgresUsageModule {}
