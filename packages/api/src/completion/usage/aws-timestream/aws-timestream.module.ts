import { Module } from '@nestjs/common';
import { AWSTimestreamDatabaseService } from './storage/database.service';
import { AWSTimestreamMigrationsModule } from './migrations/migrations.module';
import { AWSTimestreamMigrationsService } from './migrations/migrations.service';
import { QuestDBCompletionUsageProvider } from './aws-timestream.provider';
import { COMPLETION_USAGE_PROVIDER } from '../usage.types';

@Module({
  imports: [AWSTimestreamMigrationsModule],
  controllers: [],
  providers: [
    AWSTimestreamDatabaseService,
    AWSTimestreamMigrationsService,
    {
      provide: COMPLETION_USAGE_PROVIDER,
      useClass: QuestDBCompletionUsageProvider,
    },
  ],
  exports: [
    AWSTimestreamDatabaseService,
    AWSTimestreamMigrationsService,
    COMPLETION_USAGE_PROVIDER,
  ],
})
export class AWSTimestreamModule {}
