import { Module } from '@nestjs/common';
import { AIResourceService } from './ai-resource.service';
import { AIResourceController } from './ai-resource.controller';
import { WorkspaceModule } from '../workspace/workspace.module';
import { ApiKeyModule } from '../api-key/api-key.module';
import { PoolDefinitionModule } from '../pool-definition/pool-definition.module';
import { AIConnectionModule } from '../ai-connection/ai-connection.module';

@Module({
  imports: [
    WorkspaceModule,
    ApiKeyModule,
    PoolDefinitionModule,
    AIConnectionModule,
  ],
  controllers: [AIResourceController],
  providers: [AIResourceService],
  exports: [AIResourceService],
})
export class AIResourceModule {}
