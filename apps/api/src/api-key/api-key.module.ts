import { Module } from '@nestjs/common';
import { WorkspaceModule } from '../workspace/workspace.module';
import { ApiKeyService } from './api-key.service';
import { ApiKeyController } from './api-key.controller';
import { ApiKeyGuard } from './api-key.guard';

@Module({
  imports: [WorkspaceModule],
  controllers: [ApiKeyController],
  providers: [ApiKeyService, ApiKeyGuard],
  exports: [ApiKeyService],
})
export class ApiKeyModule {}
