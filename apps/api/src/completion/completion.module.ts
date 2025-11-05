import { Module } from '@nestjs/common';
import { CompletionService } from './completion.service';
import { WorkspaceModule } from '../workspace/workspace.module';
import { AIProviderModule } from '../ai-provider/ai-provider.module';
import { AIResourceModule } from '../ai-resource/ai-resource.module';
import { AIConnectionModule } from '../ai-connection/ai-connection.module';
import { CompletionController } from './completion.controller';
import { ApiKeyModule } from '../api-key/api-key.module';

@Module({
  imports: [
    WorkspaceModule,
    AIProviderModule,
    AIConnectionModule,
    AIResourceModule,
    ApiKeyModule,
  ],
  controllers: [CompletionController],
  providers: [CompletionService],
  exports: [CompletionService],
})
export class CompletionModule {}
