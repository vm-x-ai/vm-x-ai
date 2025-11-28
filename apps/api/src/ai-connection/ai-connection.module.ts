import { Module } from '@nestjs/common';
import { VaultModule } from '../vault/vault.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { AIConnectionService } from './ai-connection.service';
import { AIConnectionController } from './ai-connection.controller';
import { AIProviderModule } from '../ai-provider/ai-provider.module';
import { RoleModule } from '../role/role.module';

@Module({
  imports: [VaultModule, WorkspaceModule, AIProviderModule, RoleModule],
  controllers: [AIConnectionController],
  providers: [AIConnectionService],
  exports: [AIConnectionService],
})
export class AIConnectionModule {}
