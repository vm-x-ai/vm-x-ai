import { Module } from '@nestjs/common';
import { QuestDBDatabaseService } from './storage/database.service';
import { QuestDBMigrationsModule } from './migrations/migrations.module';
import { QuestDBMigrationsService } from './migrations/migrations.service';
import { QuestDBCompletionUsageProvider } from './questdb.provider';
import { COMPLETION_USAGE_PROVIDER } from '../usage.types';

@Module({
  imports: [QuestDBMigrationsModule],
  controllers: [],
  providers: [
    QuestDBDatabaseService,
    QuestDBMigrationsService,
    {
      provide: COMPLETION_USAGE_PROVIDER,
      useClass: QuestDBCompletionUsageProvider,
    },
  ],
  exports: [
    QuestDBDatabaseService,
    QuestDBMigrationsService,
    COMPLETION_USAGE_PROVIDER,
  ],
})
export class QuestDBModule {}
