import { Module } from '@nestjs/common';
import { RequestAuditService } from './audit.service';
import { RequestAuditController } from './audit.controller';
import { WorkspaceModule } from '../workspace/workspace.module';

@Module({
  imports: [WorkspaceModule],
  controllers: [RequestAuditController],
  providers: [RequestAuditService],
  exports: [RequestAuditService],
})
export class RequestAuditModule {}
