import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './storage/database.module';
import { configSchema } from './config/schema';
import { MigrationsModule } from './migrations/migrations.module';
import { HealthcheckModule } from './healthcheck/healthcheck.module';
import { UsersModule } from './users/users.module';
import { AppLoggerModule } from './logger/logger.module';
import { AuthModule } from './auth/auth.module';
import { VaultModule } from './vault/vault.module';
import { WorkspaceModule } from './workspace/workspace.module';
import { AppCacheModule } from './cache/cache.module';
import { EnvironmentModule } from './environment/environment.module';
import { AIConnectionModule } from './ai-connection/ai-connection.module';
import { AIResourceModule } from './ai-resource/ai-resource.module';
import { PoolDefinitionModule } from './pool-definition/pool-definition.module';
import { AIProviderModule } from './ai-provider/ai-provider.module';
import { CompletionModule } from './gateway/completion.module';
import { ApiKeyModule } from './api-key/api-key.module';
import { ScheduleModule } from '@nestjs/schedule';
import { RequestAuditModule } from './audit/audit.module';
import { RoleModule } from './role/role.module';
import { ModelPricingModule } from './model-pricing/model-pricing.module';
import { OpenTelemetryModule } from 'nestjs-otel';

@Module({
  imports: [
    OpenTelemetryModule.forRoot({
      metrics: {
        hostMetrics: true,
      },
    }),
    ScheduleModule.forRoot(),
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: configSchema,
    }),
    AppLoggerModule,
    AppCacheModule,
    MigrationsModule,
    DatabaseModule,
    HealthcheckModule,
    UsersModule,
    AuthModule,
    VaultModule,
    WorkspaceModule,
    EnvironmentModule,
    AIConnectionModule,
    AIResourceModule,
    PoolDefinitionModule,
    AIProviderModule,
    ApiKeyModule,
    CompletionModule,
    RequestAuditModule,
    RoleModule,
    ModelPricingModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
