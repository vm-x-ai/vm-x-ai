import { Module } from '@nestjs/common';
import { CompletionBatchItemService } from './batch-item-service';
import { CompletionBatchService } from './batch-service';
import { CompletionBatchQueueService } from './batch-queue.service';
import { CompletionBatchQueueConsumer } from './batch-queue.consumer';
import { TokenModule } from '../../token/token.module';
import { AIResourceModule } from '../../ai-resource/ai-resource.module';
import { AIConnectionModule } from '../../ai-connection/ai-connection.module';
import { CapacityModule } from '../../capacity/capacity.module';
import { GatewayOrchestratorService } from '../gateway-orchestrator.service';
import { AIProviderModule } from '../../ai-provider/ai-provider.module';
import { ResourceRoutingService } from '../routing.service';
import { GateService } from '../gate.service';
import { RequestUsageModule } from '../../usage/usage.module';
import { CompletionMetricsModule } from '../metrics/metrics.module';
import { RequestAuditModule } from '../../audit/audit.module';
import { PoolDefinitionModule } from '../../pool-definition/pool-definition.module';
import { PrioritizationModule } from '../../prioritization/prioritization.module';
import { CompletionBatchController } from './batch.controller';
import { WorkspaceModule } from '../../workspace/workspace.module';
import { ApiKeyModule } from '../../api-key/api-key.module';
import { CostModule } from '../cost/cost.module';

@Module({
  imports: [
    WorkspaceModule,
    TokenModule,
    AIResourceModule,
    AIConnectionModule,
    CapacityModule,
    AIProviderModule,
    RequestUsageModule,
    CompletionMetricsModule,
    RequestAuditModule,
    PoolDefinitionModule,
    PrioritizationModule,
    ApiKeyModule,
    CostModule,
  ],
  controllers: [CompletionBatchController],
  providers: [
    CompletionBatchItemService,
    CompletionBatchService,
    CompletionBatchQueueService,
    CompletionBatchQueueConsumer,
    GatewayOrchestratorService,
    ResourceRoutingService,
    GateService,
  ],
  exports: [],
})
export class CompletionBatchModule {}
