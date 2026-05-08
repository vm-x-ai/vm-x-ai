import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from '../../app.module';

import { UsersService } from '../../users/users.service';
import { WorkspaceService } from '../../workspace/workspace.service';
import { EnvironmentService } from '../../environment/environment.service';
import { AIConnectionService } from '../../ai-connection/ai-connection.service';
import { AIResourceService } from '../../ai-resource/ai-resource.service';
import { ApiKeyService } from '../../api-key/api-key.service';
import { DatabaseService } from '../../storage/database.service';
import type { UserEntity } from '../../users/entities/user.entity';

/**
 * Full-stack live HTTP harness for the gateway. Boots the real
 * `AppModule` (Postgres + Redis + the full DI graph) via NestJS
 * Testing + FastifyAdapter, seeds the minimum entities each test
 * needs (workspace → environment → AI connection per provider →
 * AI resource per provider → API key), and returns the running
 * Fastify app plus the plaintext API key value tests use as
 * `Authorization: Bearer <key>`.
 *
 * Calls go end-to-end:
 *
 *   inject() → Fastify → controller → guards (real auth) → service →
 *   AIProviderService → real provider class → real upstream HTTP
 *
 * **Costs real money per run** (every test makes at least one
 * upstream API call). Belongs in the `live` test project — gated by
 * `*_API_KEY` env var presence so missing keys skip gracefully.
 *
 * Pre-conditions for running locally:
 *   - docker-compose up -d (postgres on :5440, redis cluster on :7001-3)
 *   - migrations applied: `nx run api:migrate`
 *   - .env.local at workspace root has at least `OPENAI_API_KEY` etc.
 */

export type SeedProviderConfig = {
  /** Provider id matching `AIProviderService.get(...)`. */
  providerId:
    | 'openai'
    | 'anthropic'
    | 'gemini'
    | 'groq'
    | 'perplexity'
    | 'aws-bedrock'
    | 'aws-bedrock-invoke';
  /** Resource name — what the test request's `body.model` field uses. */
  resourceName: string;
  /** The actual upstream model string. */
  upstreamModel: string;
  /** Connection config (api key, region, etc.) — provider-specific. */
  connectionConfig: Record<string, unknown>;
  /** Set to false to skip seeding when env vars are missing. */
  enabled: boolean;
};

export type LiveHttpHarness = {
  app: NestFastifyApplication;
  apiKey: string;
  workspaceId: string;
  environmentId: string;
  /** Map of providerId → resourceName for resolving in tests. */
  resources: Record<string, string>;
  cleanup: () => Promise<void>;
};

/**
 * Resolve the seed provider configs whose required env vars are set.
 * Skipped providers don't get seeded (saves per-test setup time when
 * a key is unavailable in the local environment).
 */
export function discoverSeedProviders(): SeedProviderConfig[] {
  const out: SeedProviderConfig[] = [];
  if (process.env.OPENAI_API_KEY) {
    out.push({
      providerId: 'openai',
      resourceName: 'live-http-openai',
      upstreamModel: 'gpt-4o-mini',
      connectionConfig: { apiKey: process.env.OPENAI_API_KEY },
      enabled: true,
    });
  }
  if (process.env.ANTHROPIC_API_KEY) {
    out.push({
      providerId: 'anthropic',
      resourceName: 'live-http-anthropic',
      upstreamModel: 'claude-haiku-4-5',
      connectionConfig: { apiKey: process.env.ANTHROPIC_API_KEY },
      enabled: true,
    });
  }
  if (process.env.GEMINI_API_KEY) {
    out.push({
      providerId: 'gemini',
      resourceName: 'live-http-gemini',
      upstreamModel: 'gemini-2.5-flash-lite',
      connectionConfig: { apiKey: process.env.GEMINI_API_KEY },
      enabled: true,
    });
  }
  if (process.env.GROQ_API_KEY) {
    out.push({
      providerId: 'groq',
      resourceName: 'live-http-groq',
      upstreamModel: 'llama-3.3-70b-versatile',
      connectionConfig: { apiKey: process.env.GROQ_API_KEY },
      enabled: true,
    });
  }
  if (process.env.PERPLEXITYAI_API_KEY) {
    out.push({
      providerId: 'perplexity',
      resourceName: 'live-http-perplexity',
      upstreamModel: 'sonar',
      connectionConfig: { apiKey: process.env.PERPLEXITYAI_API_KEY },
      enabled: true,
    });
  }
  if (process.env.AWS_BEDROCK_ROLE_ARN && process.env.AWS_REGION) {
    out.push({
      providerId: 'aws-bedrock',
      resourceName: 'live-http-bedrock-converse',
      upstreamModel: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
      connectionConfig: {
        iamRoleArn: process.env.AWS_BEDROCK_ROLE_ARN,
        region: process.env.AWS_REGION,
      },
      enabled: true,
    });
    out.push({
      providerId: 'aws-bedrock-invoke',
      resourceName: 'live-http-bedrock-invoke',
      upstreamModel: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
      connectionConfig: {
        iamRoleArn: process.env.AWS_BEDROCK_ROLE_ARN,
        region: process.env.AWS_REGION,
      },
      enabled: true,
    });
  }
  return out;
}

export async function createLiveHttpHarness(
  seedProviders: SeedProviderConfig[] = discoverSeedProviders()
): Promise<LiveHttpHarness> {
  // Bootstrap the real AppModule. Migrations auto-apply on
  // `DatabaseService.onModuleInit`, so the schema is in place before
  // we seed.
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter()
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  // Seed via real services so encryption / hashing / validation all
  // run the way they would in production. Use the migration's
  // pre-seeded `admin` user as the actor.
  const usersService = app.get(UsersService);
  const workspaceService = app.get(WorkspaceService);
  const environmentService = app.get(EnvironmentService);
  const aiConnectionService = app.get(AIConnectionService);
  const aiResourceService = app.get(AIResourceService);
  const apiKeyService = app.get(ApiKeyService);
  const db = app.get(DatabaseService);

  const adminUser = await usersService.getByUsername('admin');
  if (!adminUser) {
    throw new Error(
      'live-http harness: expected migration-seeded admin user; got none. Did migrations run?'
    );
  }
  const user: UserEntity = adminUser;

  const workspace = await workspaceService.create(
    {
      name: `live-http-${Date.now()}`,
      description: 'Workspace seeded by the live HTTP harness',
    },
    user
  );
  const environment = await environmentService.create(
    workspace.workspaceId,
    {
      name: 'default',
      description: 'Default env for live HTTP tests',
    },
    user
  );

  const resources: Record<string, string> = {};
  const resourceIds: string[] = [];
  for (const cfg of seedProviders) {
    if (!cfg.enabled) continue;
    const connection = await aiConnectionService.create(
      workspace.workspaceId,
      environment.environmentId,
      {
        name: `live-${cfg.providerId}`,
        provider: cfg.providerId,
        config: cfg.connectionConfig,
      } as never,
      user
    );
    const resource = await aiResourceService.create(
      workspace.workspaceId,
      environment.environmentId,
      {
        name: cfg.resourceName,
        useFallback: false,
        enforceCapacity: false,
        model: {
          provider: cfg.providerId,
          model: cfg.upstreamModel,
          connectionId: connection.connectionId,
        },
      } as never,
      user
    );
    resources[cfg.providerId] = cfg.resourceName;
    resourceIds.push(resource.resourceId);
  }

  // `ApiKeyGuard.verify` checks `apiKey.resources.includes(resourceUuid)`,
  // so the key must enumerate every resource we just seeded — there's no
  // "empty == all" shortcut.
  const apiKeyDto = await apiKeyService.create(
    workspace.workspaceId,
    environment.environmentId,
    {
      name: 'live-http-key',
      enabled: true,
      resources: resourceIds,
    } as never,
    user
  );

  return {
    app,
    apiKey: apiKeyDto.apiKeyValue,
    workspaceId: workspace.workspaceId,
    environmentId: environment.environmentId,
    resources,
    cleanup: async () => {
      // Cascade the workspace delete — the schema's foreign-key
      // constraints clean up envs / resources / connections / api
      // keys / audit rows.
      await db.writer
        .deleteFrom('workspaces')
        .where('workspaceId', '=', workspace.workspaceId)
        .execute();
      await app.close();
    },
  };
}

/**
 * URL builder mirroring the controller routes — uses real UUID
 * workspace + environment IDs from the seeded harness.
 */
export function gatewayUrls(
  harness: Pick<LiveHttpHarness, 'workspaceId' | 'environmentId'>
) {
  const base = `/completion/${harness.workspaceId}/${harness.environmentId}`;
  return {
    chatCompletions: `${base}/chat/completions`,
    responses: `${base}/responses`,
    anthropicMessages: `${base}/anthropic/messages`,
  };
}
