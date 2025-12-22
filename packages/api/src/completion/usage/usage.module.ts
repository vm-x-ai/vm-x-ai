import { Module } from '@nestjs/common';
import { QuestDBModule } from './questdb/questdb.module';
import { CompletionUsageService } from './usage.service';
import { CompletionUsageController } from './usage.controller';
import { WorkspaceModule } from '../../workspace/workspace.module';
import { AIConnectionModule } from '../../ai-connection/ai-connection.module';
import { AIProviderModule } from '../../ai-provider/ai-provider.module';
import { ApiKeyModule } from '../../api-key/api-key.module';
import { EnvironmentModule } from '../../environment/environment.module';
import { AIResourceModule } from '../../ai-resource/ai-resource.module';
import { UsersModule } from '../../users/users.module';
import { ConditionalModule } from '@nestjs/config';
import { AWSTimestreamModule } from './aws-timestream/aws-timestream.module';

@Module({
  imports: [
    ConditionalModule.registerWhen(
      QuestDBModule,
      (env: NodeJS.ProcessEnv) => env.COMPLETION_USAGE_PROVIDER === 'questdb'
    ),
    ConditionalModule.registerWhen(
      AWSTimestreamModule,
      (env: NodeJS.ProcessEnv) =>
        env.COMPLETION_USAGE_PROVIDER === 'aws-timestream'
    ),
    WorkspaceModule,
    EnvironmentModule,
    AIResourceModule,
    AIConnectionModule,
    AIProviderModule,
    ApiKeyModule,
    UsersModule,
  ],
  controllers: [CompletionUsageController],
  providers: [CompletionUsageService],
  exports: [CompletionUsageService],
})
export class CompletionUsageModule {}
