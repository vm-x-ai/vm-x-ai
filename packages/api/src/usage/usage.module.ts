import { Module } from '@nestjs/common';
import { RequestUsageService } from './usage.service';
import { RequestUsageController } from './usage.controller';
import { WorkspaceModule } from '../workspace/workspace.module';
import { AIConnectionModule } from '../ai-connection/ai-connection.module';
import { AIProviderModule } from '../ai-provider/ai-provider.module';
import { ApiKeyModule } from '../api-key/api-key.module';
import { EnvironmentModule } from '../environment/environment.module';
import { AIResourceModule } from '../ai-resource/ai-resource.module';
import { UsersModule } from '../users/users.module';
import { PostgresUsageModule } from './postgres/postgres.module';

@Module({
  imports: [
    PostgresUsageModule,
    WorkspaceModule,
    EnvironmentModule,
    AIResourceModule,
    AIConnectionModule,
    AIProviderModule,
    ApiKeyModule,
    UsersModule,
  ],
  controllers: [RequestUsageController],
  providers: [RequestUsageService],
  exports: [RequestUsageService],
})
export class RequestUsageModule {}
