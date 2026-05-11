/**
 * One-shot seed script for the api-completion examples.
 *
 * Boots a *minimal* NestJS context — DB + cache + vault + the small set
 * of services the seed needs — instead of the full `AppModule`. The
 * full AppModule pulls in OIDC, queues, schedulers and the HTTP adapter
 * which take seconds to seconds-to-minutes to settle and aren't needed
 * to insert a few rows.
 *
 * Idempotent: a workspace named `api-completion-examples` is reused if
 * present. The API key is rotated each run (plaintext can't be
 * recovered from the stored hash, so a fresh value is the only honest
 * contract).
 *
 * Output: `KEY=value` pairs on stdout. The wrapping shell script
 * (`scripts/setup.sh`) tees stdout to `examples/api-completion/.env.local`,
 * which `config.py` then loads at import time.
 */
import 'reflect-metadata';
import { Module, type Type } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';

import { configSchema } from '../src/config/schema';
import { AppLoggerModule } from '../src/logger/logger.module';
import { AppCacheModule } from '../src/cache/cache.module';
import { DatabaseModule } from '../src/storage/database.module';
import { VaultModule } from '../src/vault/vault.module';
import { UsersModule } from '../src/users/users.module';
import { WorkspaceModule } from '../src/workspace/workspace.module';
import { EnvironmentModule } from '../src/environment/environment.module';
import { AIConnectionModule } from '../src/ai-connection/ai-connection.module';
import { AIResourceModule } from '../src/ai-resource/ai-resource.module';
import { AIProviderModule } from '../src/ai-provider/ai-provider.module';
import { ApiKeyModule } from '../src/api-key/api-key.module';
import { RoleModule } from '../src/role/role.module';

import { UsersService } from '../src/users/users.service';
import { WorkspaceService } from '../src/workspace/workspace.service';
import { EnvironmentService } from '../src/environment/environment.service';
import { AIConnectionService } from '../src/ai-connection/ai-connection.service';
import { AIResourceService } from '../src/ai-resource/ai-resource.service';
import { ApiKeyService } from '../src/api-key/api-key.service';
import type { UserEntity } from '../src/users/entities/user.entity';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: configSchema,
    }),
    AppLoggerModule,
    AppCacheModule,
    DatabaseModule,
    VaultModule,
    RoleModule,
    UsersModule,
    WorkspaceModule,
    EnvironmentModule,
    AIProviderModule,
    AIConnectionModule,
    AIResourceModule,
    ApiKeyModule,
  ],
})
class SeedModule {}

const WORKSPACE_NAME = 'api-completion-examples';
const ENVIRONMENT_NAME = 'default';
const API_KEY_NAME = 'examples-key';

type ProviderSeed = {
  envVar: string;
  providerId: 'openai' | 'anthropic' | 'gemini' | 'groq' | 'perplexity';
  connectionName: string;
  resourceName: string;
  resourceEnvKey: string;
  upstreamModel: string;
  buildConfig: (apiKey: string) => Record<string, unknown>;
};

const PROVIDERS: ProviderSeed[] = [
  {
    envVar: 'OPENAI_API_KEY',
    providerId: 'openai',
    connectionName: 'openai',
    resourceName: 'openai',
    resourceEnvKey: 'VMX_OPENAI_RESOURCE',
    upstreamModel: 'gpt-4o-mini',
    buildConfig: (apiKey) => ({ apiKey }),
  },
  // Separate resource for web-search demos. The general-purpose `openai`
  // resource uses gpt-4o-mini (cheap, no web_search tool support);
  // `openai-search` pins the gpt-5 search-api model so the
  // /responses endpoint can route the hosted web_search tool.
  {
    envVar: 'OPENAI_API_KEY',
    providerId: 'openai',
    connectionName: 'openai',
    resourceName: 'openai-search',
    resourceEnvKey: 'VMX_OPENAI_SEARCH_RESOURCE',
    upstreamModel: 'gpt-5-search-api',
    buildConfig: (apiKey) => ({ apiKey }),
  },
  {
    envVar: 'ANTHROPIC_API_KEY',
    providerId: 'anthropic',
    connectionName: 'anthropic',
    resourceName: 'anthropic',
    resourceEnvKey: 'VMX_ANTHROPIC_RESOURCE',
    upstreamModel: 'claude-haiku-4-5',
    buildConfig: (apiKey) => ({ apiKey }),
  },
  // Separate resource for the Claude Agent SDK examples. The SDK's
  // CLI sends `output_config.effort`, `context_management`, and other
  // modern features that Haiku 4.5 doesn't support — so the general-
  // purpose `anthropic` resource above returns 400 for those clients.
  // This resource pins Sonnet 4.5, which accepts the full feature
  // surface the agent CLI emits.
  {
    envVar: 'ANTHROPIC_API_KEY',
    providerId: 'anthropic',
    connectionName: 'anthropic',
    resourceName: 'anthropic-agent',
    resourceEnvKey: 'VMX_ANTHROPIC_AGENT_RESOURCE',
    upstreamModel: 'claude-sonnet-4-6',
    buildConfig: (apiKey) => ({ apiKey }),
  },
  {
    envVar: 'GEMINI_API_KEY',
    providerId: 'gemini',
    connectionName: 'gemini',
    resourceName: 'gemini',
    resourceEnvKey: 'VMX_GEMINI_RESOURCE',
    upstreamModel: 'gemini-2.5-flash-lite',
    buildConfig: (apiKey) => ({ apiKey }),
  },
  {
    envVar: 'PERPLEXITYAI_API_KEY',
    providerId: 'perplexity',
    connectionName: 'perplexity',
    resourceName: 'perplexity',
    resourceEnvKey: 'VMX_PERPLEXITY_RESOURCE',
    upstreamModel: 'sonar',
    buildConfig: (apiKey) => ({ apiKey }),
  },
];

async function main(): Promise<void> {
  console.error('[seed] creating Nest application context…');
  const app = await NestFactory.createApplicationContext(
    SeedModule as unknown as Type<unknown>,
    { logger: ['error', 'warn'] }
  );
  console.error('[seed] context up, seeding…');

  try {
    const usersService = app.get(UsersService);
    const workspaceService = app.get(WorkspaceService);
    const environmentService = app.get(EnvironmentService);
    const aiConnectionService = app.get(AIConnectionService);
    const aiResourceService = app.get(AIResourceService);
    const apiKeyService = app.get(ApiKeyService);

    const adminUser = await usersService.getByUsername('admin');
    if (!adminUser) {
      throw new Error(
        'expected migration-seeded admin user; got none. Run `pnpm exec nx run api:migrate` first.'
      );
    }
    const user: UserEntity = adminUser;

    const allWorkspaces = await workspaceService.getAll({});
    let workspace = allWorkspaces.find((w) => w.name === WORKSPACE_NAME);
    if (!workspace) {
      workspace = await workspaceService.create(
        {
          name: WORKSPACE_NAME,
          description: 'Workspace for the API completion examples.',
        },
        user
      );
    }
    const envs = await environmentService.getAll({
      workspaceId: workspace.workspaceId,
    });
    let environment = envs.find((e) => e.name === ENVIRONMENT_NAME);
    if (!environment) {
      environment = await environmentService.create(
        workspace.workspaceId,
        {
          name: ENVIRONMENT_NAME,
          description: 'Default env for the examples.',
        },
        user
      );
    }

    const resourceLines: string[] = [];
    const seededResourceIds: string[] = [];
    for (const seed of PROVIDERS) {
      const apiKey = process.env[seed.envVar];
      if (!apiKey) continue;

      const connections = await aiConnectionService.getAll({
        workspaceId: workspace.workspaceId,
        environmentId: environment.environmentId,
      });
      let connection = connections.find((c) => c.name === seed.connectionName);
      if (!connection) {
        connection = await aiConnectionService.create(
          workspace.workspaceId,
          environment.environmentId,
          {
            name: seed.connectionName,
            provider: seed.providerId,
            config: seed.buildConfig(apiKey),
          } as never,
          user
        );
      }

      const existingResource = await aiResourceService.getByName(
        workspace.workspaceId,
        environment.environmentId,
        seed.resourceName,
        false
      );
      let resource = existingResource ?? undefined;
      if (!resource) {
        resource = await aiResourceService.create(
          workspace.workspaceId,
          environment.environmentId,
          {
            name: seed.resourceName,
            useFallback: false,
            enforceCapacity: false,
            model: {
              provider: seed.providerId,
              model: seed.upstreamModel,
              connectionId: connection.connectionId,
            },
          } as never,
          user
        );
      }
      seededResourceIds.push(resource.resourceId);
      resourceLines.push(`${seed.resourceEnvKey}=${seed.resourceName}`);
    }

    const existingKeys = await apiKeyService.getAll({
      workspaceId: workspace.workspaceId,
      environmentId: environment.environmentId,
    });
    const oldKey = existingKeys.find((k) => k.name === API_KEY_NAME);
    if (oldKey) {
      await apiKeyService.delete(
        workspace.workspaceId,
        environment.environmentId,
        oldKey.apiKeyId
      );
    }
    const created = await apiKeyService.create(
      workspace.workspaceId,
      environment.environmentId,
      {
        name: API_KEY_NAME,
        enabled: true,
        resources: seededResourceIds,
      } as never,
      user
    );

    console.log(`# Generated by packages/api/scripts/seed-examples.ts`);
    console.log(`VMX_BASE_URL=http://localhost:3030/api`);
    console.log(`VMX_WORKSPACE_ID=${workspace.workspaceId}`);
    console.log(`VMX_ENVIRONMENT_ID=${environment.environmentId}`);
    console.log(`VMX_API_KEY=${created.apiKeyValue}`);
    for (const line of resourceLines) console.log(line);
  } finally {
    // Best-effort close; the cache module's Redis cluster and other
    // lifecycle handles can keep the loop alive for minutes after work
    // is done. Force exit once we've printed our output.
    try {
      await app.close();
    } catch {
      // ignore
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('seed failed:', err);
    process.exit(1);
  });
