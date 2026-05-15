import { describe, expect, it, vi } from 'vitest';
import { PinoLogger } from 'nestjs-pino';
import { CapacityService } from './capacity.service';
import { CapacityPeriod } from './capacity.entity';
import { RedisClient } from '../cache/redis-client';
import type { AIConnectionEntity } from '../ai-connection/entities/ai-connection.entity';
import type { AIResourceEntity } from '../ai-resource/entities/ai-resource.entity';
import type { ApiKeyEntity } from '../api-key/entities/api-key.entity';

/**
 * Unit tests for {@link CapacityService.getCapacityUsage}. The method
 * compiles the tightest applicable limit across configured (Connection
 * + Resource + API Key) and discovered (fresh ≤7 days) sources, reads
 * shared Redis counters once, and projects derived `remaining*` /
 * `*UsagePercent` fields. Redis is stubbed with a thin in-memory mock
 * so the assertions can focus on the projection logic rather than the
 * cluster client.
 */

function makeService(redisGets: Record<string, string | null> = {}): {
  service: CapacityService;
} {
  const logger = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as PinoLogger;
  const redisClient = {
    client: {
      get: vi.fn(async (key: string) => redisGets[key] ?? null),
    },
  } as unknown as RedisClient;
  return { service: new CapacityService(logger, redisClient) };
}

const resource = (): AIResourceEntity =>
  ({
    resourceId: 'res-1',
    workspaceId: 'ws-1',
    environmentId: 'env-1',
    name: 'test',
    model: { provider: 'openai', model: 'gpt-4o-mini', connectionId: 'conn-1' },
  } as unknown as AIResourceEntity);

const connection = (
  overrides: Partial<AIConnectionEntity> = {}
): AIConnectionEntity =>
  ({
    connectionId: 'conn-1',
    workspaceId: 'ws-1',
    environmentId: 'env-1',
    provider: 'openai',
    capacity: [],
    discoveredCapacity: null,
    ...overrides,
  } as unknown as AIConnectionEntity);

const keyPrefix = (period: CapacityPeriod) =>
  `capacity:{ws-1:env-1:res-1:conn-1}:resource-usage:${period}`;

describe('CapacityService.getCapacityUsage', () => {
  it('returns null limits and percents when no source configures a cap', async () => {
    const { service } = makeService();
    const result = await service.getCapacityUsage(
      new Date(),
      'ws-1',
      'env-1',
      resource(),
      connection(),
      CapacityPeriod.MINUTE,
      'gpt-4o-mini'
    );
    expect(result.requestsLimit).toBeNull();
    expect(result.tokensLimit).toBeNull();
    expect(result.requestsUsagePercent).toBeNull();
    expect(result.tokensUsagePercent).toBeNull();
    expect(result.remainingRequests).toBeNull();
    expect(result.remainingTokens).toBeNull();
  });

  it('picks the connection-level limit and derives a percent', async () => {
    const { service } = makeService({
      [`${keyPrefix(CapacityPeriod.MINUTE)}:requests`]: '49',
      [`${keyPrefix(CapacityPeriod.MINUTE)}:tokens`]: '5000',
    });
    const result = await service.getCapacityUsage(
      new Date(),
      'ws-1',
      'env-1',
      resource(),
      connection({
        capacity: [
          {
            period: CapacityPeriod.MINUTE,
            requests: 100,
            tokens: 10000,
            enabled: true,
          },
        ],
      }),
      CapacityPeriod.MINUTE,
      'gpt-4o-mini'
    );
    expect(result.requestsLimit).toBe(100);
    expect(result.tokensLimit).toBe(10000);
    expect(result.requestsLimitSource).toBe('connection');
    expect(result.tokensLimitSource).toBe('connection');
    // getUsage adds +1 to the read count to account for the in-flight
    // request (matches the gate's view). 49 + 1 = 50.
    expect(result.totalRequests).toBe(50);
    expect(result.totalTokens).toBe(5000);
    expect(result.requestsUsagePercent).toBe(50);
    expect(result.tokensUsagePercent).toBe(50);
  });

  it('chooses the tightest non-null limit across sources and records its origin', async () => {
    const { service } = makeService();
    const res = resource();
    res.enforceCapacity = true;
    res.capacity = [
      {
        period: CapacityPeriod.MINUTE,
        requests: 200,
        tokens: 100,
        enabled: true,
      },
    ];
    const result = await service.getCapacityUsage(
      new Date(),
      'ws-1',
      'env-1',
      res,
      connection({
        capacity: [
          {
            period: CapacityPeriod.MINUTE,
            requests: 100,
            tokens: 10000,
            enabled: true,
          },
        ],
      }),
      CapacityPeriod.MINUTE,
      'gpt-4o-mini'
    );
    // Connection has tighter requests (100 < 200); resource has tighter tokens (100 < 10000).
    expect(result.requestsLimit).toBe(100);
    expect(result.requestsLimitSource).toBe('connection');
    expect(result.tokensLimit).toBe(100);
    expect(result.tokensLimitSource).toBe('resource');
  });

  it('includes API-key capacity when enforceCapacity is set on the key', async () => {
    const { service } = makeService();
    const apiKey: ApiKeyEntity = {
      enforceCapacity: true,
      capacity: [
        {
          period: CapacityPeriod.MINUTE,
          requests: 10,
          tokens: 1000,
          enabled: true,
        },
      ],
    } as unknown as ApiKeyEntity;
    const result = await service.getCapacityUsage(
      new Date(),
      'ws-1',
      'env-1',
      resource(),
      connection({
        capacity: [
          {
            period: CapacityPeriod.MINUTE,
            requests: 100,
            tokens: 10000,
            enabled: true,
          },
        ],
      }),
      CapacityPeriod.MINUTE,
      'gpt-4o-mini',
      apiKey
    );
    expect(result.requestsLimit).toBe(10);
    expect(result.requestsLimitSource).toBe('api-key');
    expect(result.tokensLimit).toBe(1000);
    expect(result.tokensLimitSource).toBe('api-key');
  });

  it('skips API-key capacity when enforceCapacity is false', async () => {
    const { service } = makeService();
    const apiKey: ApiKeyEntity = {
      enforceCapacity: false,
      capacity: [
        {
          period: CapacityPeriod.MINUTE,
          requests: 10,
          tokens: 1000,
          enabled: true,
        },
      ],
    } as unknown as ApiKeyEntity;
    const result = await service.getCapacityUsage(
      new Date(),
      'ws-1',
      'env-1',
      resource(),
      connection({
        capacity: [
          {
            period: CapacityPeriod.MINUTE,
            requests: 100,
            tokens: 10000,
            enabled: true,
          },
        ],
      }),
      CapacityPeriod.MINUTE,
      'gpt-4o-mini',
      apiKey
    );
    expect(result.requestsLimit).toBe(100);
    expect(result.requestsLimitSource).toBe('connection');
  });

  it('includes fresh discovered capacity (≤7 days) and tags its source', async () => {
    const { service } = makeService();
    const now = new Date('2026-05-15T12:00:00Z');
    const result = await service.getCapacityUsage(
      now,
      'ws-1',
      'env-1',
      resource(),
      connection({
        discoveredCapacity: {
          models: {
            'gpt-4o-mini': {
              updatedAt: new Date('2026-05-14T12:00:00Z').toISOString(),
              capacity: [
                {
                  period: CapacityPeriod.MINUTE,
                  requests: 50,
                  tokens: 5000,
                  enabled: true,
                },
              ],
            },
          },
        },
      }),
      CapacityPeriod.MINUTE,
      'gpt-4o-mini'
    );
    expect(result.requestsLimit).toBe(50);
    expect(result.requestsLimitSource).toBe('discovered');
  });

  it('drops stale discovered capacity (>7 days)', async () => {
    const { service } = makeService();
    const now = new Date('2026-05-15T12:00:00Z');
    const result = await service.getCapacityUsage(
      now,
      'ws-1',
      'env-1',
      resource(),
      connection({
        discoveredCapacity: {
          models: {
            'gpt-4o-mini': {
              updatedAt: new Date('2026-05-01T12:00:00Z').toISOString(),
              capacity: [
                {
                  period: CapacityPeriod.MINUTE,
                  requests: 50,
                  tokens: 5000,
                  enabled: true,
                },
              ],
            },
          },
        },
      }),
      CapacityPeriod.MINUTE,
      'gpt-4o-mini'
    );
    expect(result.requestsLimit).toBeNull();
    expect(result.tokensLimit).toBeNull();
  });

  it('clamps usage percent at 100 when total exceeds the cap', async () => {
    const { service } = makeService({
      [`${keyPrefix(CapacityPeriod.MINUTE)}:tokens`]: '15000',
    });
    const result = await service.getCapacityUsage(
      new Date(),
      'ws-1',
      'env-1',
      resource(),
      connection({
        capacity: [
          {
            period: CapacityPeriod.MINUTE,
            requests: null,
            tokens: 10000,
            enabled: true,
          },
        ],
      }),
      CapacityPeriod.MINUTE,
      'gpt-4o-mini'
    );
    expect(result.tokensUsagePercent).toBe(100);
    expect(result.remainingTokens).toBe(0);
  });

  it('reads source-IP-dimensioned caps against the per-IP counter when request is supplied', async () => {
    // Global counter: 50 req / 5000 tok. Per-IP counter: 9 req / 900 tok.
    // The connection sets a source-IP cap (10 req / 1000 tok), so the
    // gate would enforce against the per-IP counter (9+1=10, 900) —
    // already saturated. Routing should see the same saturation.
    const { service } = makeService({
      'capacity:{ws-1:env-1:res-1:conn-1}:resource-usage:minute:requests': '50',
      'capacity:{ws-1:env-1:res-1:conn-1}:resource-usage:minute:tokens': '5000',
      'capacity:{ws-1:env-1:res-1:conn-1}:resource-usage:source-ip:1.2.3.4:minute:requests':
        '9',
      'capacity:{ws-1:env-1:res-1:conn-1}:resource-usage:source-ip:1.2.3.4:minute:tokens':
        '900',
    });
    const fakeRequest = {
      headers: { 'x-forwarded-for': '1.2.3.4' },
      socket: {},
    } as never;
    const result = await service.getCapacityUsage(
      new Date(),
      'ws-1',
      'env-1',
      resource(),
      connection({
        capacity: [
          {
            period: CapacityPeriod.MINUTE,
            requests: 10,
            tokens: 1000,
            enabled: true,
            dimension: 'source-ip' as never,
          },
        ],
      }),
      CapacityPeriod.MINUTE,
      'gpt-4o-mini',
      undefined,
      fakeRequest
    );
    expect(result.totalRequests).toBe(10);
    expect(result.totalTokens).toBe(900);
    expect(result.requestsUsagePercent).toBe(100);
    expect(result.tokensUsagePercent).toBe(90);
  });

  it('reads metadata-dimensioned caps against the per-field-value counter', async () => {
    // Configured cap: 10 req / 1000 tok per minute, bucketed by
    // `userId` from `payload.vmx.metadata`. The per-userId counter
    // sits at 7/700; the global counter (50/5000) shouldn't influence
    // the read.
    const { service } = makeService({
      'capacity:{ws-1:env-1:res-1:conn-1}:resource-usage:minute:requests': '50',
      'capacity:{ws-1:env-1:res-1:conn-1}:resource-usage:minute:tokens': '5000',
      'capacity:{ws-1:env-1:res-1:conn-1}:resource-usage:metadata:userId:u_42:minute:requests':
        '7',
      'capacity:{ws-1:env-1:res-1:conn-1}:resource-usage:metadata:userId:u_42:minute:tokens':
        '700',
    });
    const result = await service.getCapacityUsage(
      new Date(),
      'ws-1',
      'env-1',
      resource(),
      connection({
        capacity: [
          {
            period: CapacityPeriod.MINUTE,
            requests: 10,
            tokens: 1000,
            enabled: true,
            dimension: 'metadata' as never,
            dimensionField: 'userId',
          } as never,
        ],
      }),
      CapacityPeriod.MINUTE,
      'gpt-4o-mini',
      undefined,
      undefined,
      { userId: 'u_42' }
    );
    expect(result.totalRequests).toBe(8); // 7 + 1 in-flight
    expect(result.totalTokens).toBe(700);
    expect(result.requestsUsagePercent).toBe(80);
    expect(result.tokensUsagePercent).toBe(70);
  });

  it('buckets metadata-dimensioned caps under "unknown" when the field is missing', async () => {
    const { service } = makeService({
      'capacity:{ws-1:env-1:res-1:conn-1}:resource-usage:metadata:userId:unknown:minute:requests':
        '4',
    });
    const result = await service.getCapacityUsage(
      new Date(),
      'ws-1',
      'env-1',
      resource(),
      connection({
        capacity: [
          {
            period: CapacityPeriod.MINUTE,
            requests: 10,
            tokens: 1000,
            enabled: true,
            dimension: 'metadata' as never,
            dimensionField: 'userId',
          } as never,
        ],
      }),
      CapacityPeriod.MINUTE,
      'gpt-4o-mini',
      undefined,
      undefined,
      // metadata object has *no* `userId` field
      { team: 'growth' }
    );
    expect(result.totalRequests).toBe(5); // 4 + 1 in-flight
    expect(result.requestsUsagePercent).toBe(50);
  });

  it('skips disabled capacity entries', async () => {
    const { service } = makeService();
    const result = await service.getCapacityUsage(
      new Date(),
      'ws-1',
      'env-1',
      resource(),
      connection({
        capacity: [
          {
            period: CapacityPeriod.MINUTE,
            requests: 100,
            tokens: 10000,
            enabled: false,
          },
        ],
      }),
      CapacityPeriod.MINUTE,
      'gpt-4o-mini'
    );
    expect(result.requestsLimit).toBeNull();
    expect(result.tokensLimit).toBeNull();
  });
});
