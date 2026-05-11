import { Module } from '@nestjs/common';
import { GatewayOrchestratorService } from './gateway-orchestrator.service';
import { WorkspaceModule } from '../workspace/workspace.module';
import { AIProviderModule } from '../ai-provider/ai-provider.module';
import { AIResourceModule } from '../ai-resource/ai-resource.module';
import { AIConnectionModule } from '../ai-connection/ai-connection.module';
import { ChatCompletionsController } from './chat-completions/chat-completions.controller';
import { ChatCompletionsService } from './chat-completions/chat-completions.service';
import { ApiKeyModule } from '../api-key/api-key.module';
import { CapacityModule } from '../capacity/capacity.module';
import { PrioritizationModule } from '../prioritization/prioritization.module';
import { TokenModule } from '../token/token.module';
import { ResourceRoutingService } from './routing.service';
import { GateService } from './gate.service';
import { PoolDefinitionModule } from '../pool-definition/pool-definition.module';
import { CompletionMetricsModule } from './metrics/metrics.module';
import { RequestAuditModule } from '../audit/audit.module';
import { RequestUsageModule } from '../usage/usage.module';
import { CompletionBatchModule } from './batch/batch.module';
import { CostModule } from './cost/cost.module';
import { ResponsesController } from './responses/responses.controller';
import { ResponsesService } from './responses/responses.service';
import { AnthropicController } from './anthropic/anthropic.controller';
import { AnthropicMessagesService } from './anthropic/anthropic.service';

@Module({
  imports: [
    WorkspaceModule,
    AIProviderModule,
    AIConnectionModule,
    AIResourceModule,
    ApiKeyModule,
    CapacityModule,
    PoolDefinitionModule,
    PrioritizationModule,
    TokenModule,
    CompletionMetricsModule,
    RequestAuditModule,
    RequestUsageModule,
    CompletionBatchModule,
    CostModule,
  ],
  controllers: [
    ChatCompletionsController,
    ResponsesController,
    AnthropicController,
  ],
  providers: [
    GatewayOrchestratorService,
    GateService,
    ResourceRoutingService,
    ChatCompletionsService,
    ResponsesService,
    AnthropicMessagesService,
  ],
  exports: [
    GatewayOrchestratorService,
    ChatCompletionsService,
    ResponsesService,
    AnthropicMessagesService,
  ],
})
export class CompletionModule {}
