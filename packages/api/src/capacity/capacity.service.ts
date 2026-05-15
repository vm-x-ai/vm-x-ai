import { Injectable } from '@nestjs/common';
import {
  CapacityDimension,
  CapacityEntity,
  CapacityPeriod,
} from './capacity.entity';
import { PinoLogger } from 'nestjs-pino';
import { RedisClient } from '../cache/redis-client';
import { AIConnectionEntity } from '../ai-connection/entities/ai-connection.entity';
import { AIResourceEntity } from '../ai-resource/entities/ai-resource.entity';
import type { FastifyRequest } from 'fastify';
import { ApiKeyEntity } from '../api-key/entities/api-key.entity';
import { getSourceIpFromRequest } from '../utils/http';
import { endOfWeek, endOfMonth, isAfter, subDays } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

/**
 * Which configured source contributed the tightest limit on an axis.
 * Exposed on `CapacityUsageResult` so advanced routing templates can
 * branch on the limit's origin (e.g. only react when the provider-
 * discovered limit is biting, not when an operator set a soft cap).
 */
export type CapacityLimitSource =
  | 'connection'
  | 'resource'
  | 'api-key'
  | 'discovered';

/**
 * Rich-shape return value of `getCapacityUsage`. Every derived field
 * (`remaining*`, `*UsagePercent`) is `null` when its underlying limit
 * is `null` — i.e. when no source configured a cap on that axis.
 * Routing templates can pick whichever property fits the rule
 * (`tokensUsagePercent`, `remainingRequests`, …) without learning the
 * full shape; advanced users can read the counters / sources directly.
 */
export type CapacityUsageResult = {
  totalRequests: number;
  totalTokens: number;
  remainingSeconds: number;
  requestsLimit: number | null;
  tokensLimit: number | null;
  requestsLimitSource: CapacityLimitSource | null;
  tokensLimitSource: CapacityLimitSource | null;
  remainingRequests: number | null;
  remainingTokens: number | null;
  requestsUsagePercent: number | null;
  tokensUsagePercent: number | null;
};

/**
 * Stale-discovery window for `aiConnection.discoveredCapacity`. Provider
 * rate limits can shift between when we learned them off a response
 * header and now; older than this and downstream consumers (batch
 * dispatch, routing capacity-usage rules) should not key decisions off
 * them. One source of truth — both `batch-queue.service.ts` and
 * `getCapacityUsage` reference this constant.
 */
export const DISCOVERED_CAPACITY_FRESHNESS_DAYS = 7;

/**
 * Bucket used for requests that don't carry the configured metadata
 * field for a METADATA-dimensioned cap. Mirrors how SOURCE_IP behaves
 * when the IP is unresolvable: anonymous traffic shares one bucket and
 * still gets rate-limited, rather than slipping past the cap entirely.
 */
export const METADATA_DIMENSION_UNKNOWN_VALUE = 'unknown';

/**
 * Map the human-readable `source` string `resolve()` emits to the
 * compact `CapacityLimitSource` enum surfaced on `CapacityUsageResult`.
 * Kept as a module-local helper so callers don't have to memorise the
 * string variants.
 */
function mapResolveSource(source: string): CapacityLimitSource {
  switch (source) {
    case 'AI Connection':
      return 'connection';
    case 'AI Resource':
      return 'resource';
    case 'API Key':
      return 'api-key';
    default:
      // Unknown sources fall back to 'connection' — every contributor
      // we expose today is one of the three above. Future additions
      // should extend `CapacityLimitSource` and the resolve() source
      // strings together.
      return 'connection';
  }
}

export type PrefixedCapacity = {
  capacity: CapacityEntity;
  keyPrefix: string;
};

export type ResolvedCapacity = {
  capacity: CapacityEntity;
  keyPrefix: string;
  source: string;
  dimensionValue?: string;
};

type UsageMetrics = {
  [period: string]: {
    totalRequests: number;
    usedTokens: number;
    remainingSeconds: number;
  };
};

@Injectable()
export class CapacityService {
  private capacityPeriodMap: Record<string, (now: Date) => number> = {};

  constructor(
    private readonly logger: PinoLogger,
    private readonly redisClient: RedisClient
  ) {
    this.capacityPeriodMap[CapacityPeriod.MINUTE] =
      this.getRemainingSecondsByMinute;
    this.capacityPeriodMap[CapacityPeriod.HOUR] =
      this.getRemainingSecondsByHour;
    this.capacityPeriodMap[CapacityPeriod.DAY] = this.getRemainingSecondsByDay;
    this.capacityPeriodMap[CapacityPeriod.WEEK] =
      this.getRemainingSecondsOfWeek;
    this.capacityPeriodMap[CapacityPeriod.MONTH] =
      this.getRemainingSecondsOfMonth;
    this.capacityPeriodMap[CapacityPeriod.LIFETIME] = () => -1;
  }

  getResourceKeyPrefix(
    workspaceId: string,
    environmentId: string,
    resourceId: string,
    aiConnectionId: string
  ) {
    return `capacity:{${workspaceId}:${environmentId}:${resourceId}:${aiConnectionId}}`;
  }

  async getUsage(
    timestamp: Date,
    capacity: PrefixedCapacity[]
  ): Promise<UsageMetrics> {
    const uniqPeriods = [
      ...new Set(
        capacity.map(
          ({ capacity, keyPrefix }) => `${capacity.period}##${keyPrefix}`
        )
      ),
    ].map((key) => ({
      period: key.split('##')[0] as CapacityPeriod,
      keyPrefix: key.split('##')[1],
    }));

    const usageMetrics = await Promise.all([
      ...uniqPeriods.map(async ({ period, keyPrefix }) => {
        const key = `${keyPrefix}${period}`;
        const [totalRequestsOpt, usedTokensOpt] = await Promise.all([
          this.redisClient.client.get(`${key}:requests`),
          this.redisClient.client.get(`${key}:tokens`),
        ]);

        const remainingSeconds = this.capacityPeriodMap[period](timestamp);

        const totalRequests = totalRequestsOpt
          ? parseInt(totalRequestsOpt) + 1
          : 0;
        const usedTokens = usedTokensOpt ? parseInt(usedTokensOpt) : 0;

        return { period, totalRequests, usedTokens, remainingSeconds };
      }),
    ]);

    return usageMetrics.reduce<UsageMetrics>((acc, value) => {
      acc[value.period] = value;
      return acc;
    }, {});
  }

  resolve(
    workspaceId: string,
    environmentId: string,
    aiConnection: AIConnectionEntity,
    resource: AIResourceEntity,
    request?: FastifyRequest,
    apiKey?: ApiKeyEntity,
    metadata?: Record<string, string>
  ): {
    enabledCapacities: ResolvedCapacity[];
    connectionCapacities: CapacityEntity[];
  } {
    const resourceKeyPrefix = this.getResourceKeyPrefix(
      workspaceId,
      environmentId,
      resource.resourceId,
      aiConnection.connectionId
    );
    const connectionCapacities =
      aiConnection.capacity?.filter((u) => u.enabled) ?? [];
    if (connectionCapacities.length === 0) {
      this.logger.info(
        {
          resourceId: resource.resourceId,
        },
        'No resource limit for the resource'
      );
    }

    const enabledCapacities = [
      ...connectionCapacities.map((capacity) => {
        const keyPrefixAttributes = this.resolveCapacityKeyPrefix(
          capacity,
          `${resourceKeyPrefix}:resource-usage:`,
          request,
          metadata
        );

        return {
          ...keyPrefixAttributes,
          capacity,
          source: 'AI Connection',
        };
      }),
      ...(resource.enforceCapacity && resource.capacity
        ? resource.capacity
        : []
      ).map((capacity) => {
        const keyPrefixAttributes = this.resolveCapacityKeyPrefix(
          capacity,
          `${resourceKeyPrefix}:resource-usage:`,
          request,
          metadata
        );

        return {
          ...keyPrefixAttributes,
          capacity,
          source: 'AI Resource',
        };
      }),
      ...(apiKey?.enforceCapacity && apiKey?.capacity
        ? apiKey.capacity
        : []
      ).map((capacity) => {
        const keyPrefixAttributes = this.resolveCapacityKeyPrefix(
          capacity,
          `${resourceKeyPrefix}:resource-usage:`,
          request,
          metadata
        );

        return {
          ...keyPrefixAttributes,
          capacity,
          source: 'API Key',
        };
      }),
    ].filter(({ capacity }) => capacity.enabled);

    return { enabledCapacities, connectionCapacities };
  }

  /**
   * Compute current capacity usage for a (resource, connection, period)
   * tuple, normalised against the tightest applicable limit across
   * configured (Connection / Resource / API Key) and discovered
   * sources. Returns a flat object that routing templates can dereference
   * (`tokensUsagePercent`, `remainingRequests`, …).
   *
   * Cap discovery delegates to {@link resolve}, so source-IP-dimensioned
   * caps are read against their per-IP Redis key (when `request` is
   * supplied) — matching what the gate would enforce for the same
   * request. Discovered capacity is appended separately with the
   * non-dimensioned prefix (provider-discovered limits aren't
   * per-caller), gated by {@link DISCOVERED_CAPACITY_FRESHNESS_DAYS}
   * to drop stale auto-learned values.
   *
   * Selection strategy: across all (cap, its usage counter) pairs for
   * the requested period, the tightest pair on each axis — the one
   * with the highest `usage / limit` — defines the returned limit,
   * source, and counter. That's the cap that will fire 429 first.
   */
  async getCapacityUsage(
    timestamp: Date,
    workspaceId: string,
    environmentId: string,
    resource: AIResourceEntity,
    aiConnection: AIConnectionEntity,
    period: CapacityPeriod,
    model: string,
    apiKey?: ApiKeyEntity,
    request?: FastifyRequest,
    metadata?: Record<string, string>
  ): Promise<CapacityUsageResult> {
    type Item = {
      keyPrefix: string;
      cap: CapacityEntity;
      source: CapacityLimitSource;
    };

    const { enabledCapacities } = this.resolve(
      workspaceId,
      environmentId,
      aiConnection,
      resource,
      request,
      apiKey,
      metadata
    );

    const items: Item[] = enabledCapacities
      .filter(({ capacity }) => capacity.period === period)
      .map(({ capacity, keyPrefix, source }) => ({
        keyPrefix,
        cap: capacity,
        source: mapResolveSource(source),
      }));

    // Discovered caps aren't dimensioned — they describe the
    // connection-wide ceiling the provider reported, not anything
    // per-caller. Use the un-dimensioned `resource-usage:` prefix to
    // match how the gate-side counter increment writes them
    // (`gate.service.ts:155-180`).
    const discovered = aiConnection.discoveredCapacity?.models?.[model];
    if (discovered?.capacity && discovered.updatedAt) {
      const cutoff = subDays(timestamp, DISCOVERED_CAPACITY_FRESHNESS_DAYS);
      if (isAfter(new Date(discovered.updatedAt), cutoff)) {
        const discoveredPrefix = `${this.getResourceKeyPrefix(
          workspaceId,
          environmentId,
          resource.resourceId,
          aiConnection.connectionId
        )}:resource-usage:`;
        for (const cap of discovered.capacity) {
          if (cap.period !== period) continue;
          if (cap.enabled === false) continue;
          items.push({
            keyPrefix: discoveredPrefix,
            cap,
            source: 'discovered',
          });
        }
      }
    }

    // Fetch usage per distinct keyPrefix in parallel. `getUsage`
    // collapses by period and would clobber multi-dimension reads,
    // so we hit Redis directly here.
    const uniquePrefixes = [...new Set(items.map((i) => i.keyPrefix))];
    const usageByPrefix = new Map<
      string,
      { totalRequests: number; usedTokens: number }
    >();
    await Promise.all(
      uniquePrefixes.map(async (prefix) => {
        const baseKey = `${prefix}${period}`;
        const [reqOpt, tokOpt] = await Promise.all([
          this.redisClient.client.get(`${baseKey}:requests`),
          this.redisClient.client.get(`${baseKey}:tokens`),
        ]);
        usageByPrefix.set(prefix, {
          // Add +1 to the request count to mirror `getUsage`: the
          // gate's existing check is `totalRequests > limit` *after*
          // the in-flight increment, so routing should see the same
          // post-write number.
          totalRequests: reqOpt ? parseInt(reqOpt, 10) + 1 : 0,
          usedTokens: tokOpt ? parseInt(tokOpt, 10) : 0,
        });
      })
    );

    const remainingSeconds = this.capacityPeriodMap[period](timestamp);

    let requestsLimit: number | null = null;
    let tokensLimit: number | null = null;
    let requestsLimitSource: CapacityLimitSource | null = null;
    let tokensLimitSource: CapacityLimitSource | null = null;
    // Carry the usage counter belonging to the limiting cap so the
    // returned `totalRequests` / `totalTokens` describe the same axis
    // the routing rule is evaluating against. Default to 0 (no items
    // → no usage to report).
    let limitingRequestsUsage = 0;
    let limitingTokensUsage = 0;
    let maxRequestsPercent = -1;
    let maxTokensPercent = -1;

    for (const item of items) {
      const usage = usageByPrefix.get(item.keyPrefix);
      if (!usage) continue;

      const reqCap = item.cap.requests ?? 0;
      if (reqCap > 0) {
        const pct = (usage.totalRequests / reqCap) * 100;
        // Highest percent wins; tie-broken by tighter limit so a
        // freshly-spun-up resource (all caps at 0%) returns the
        // cap that'll fire 429 first as load arrives.
        if (
          pct > maxRequestsPercent ||
          (pct === maxRequestsPercent &&
            (requestsLimit === null || reqCap < requestsLimit))
        ) {
          maxRequestsPercent = pct;
          requestsLimit = reqCap;
          requestsLimitSource = item.source;
          limitingRequestsUsage = usage.totalRequests;
        }
      }

      const tokCap = item.cap.tokens ?? 0;
      if (tokCap > 0) {
        const pct = (usage.usedTokens / tokCap) * 100;
        if (
          pct > maxTokensPercent ||
          (pct === maxTokensPercent &&
            (tokensLimit === null || tokCap < tokensLimit))
        ) {
          maxTokensPercent = pct;
          tokensLimit = tokCap;
          tokensLimitSource = item.source;
          limitingTokensUsage = usage.usedTokens;
        }
      }
    }

    // If no source defined a limit on an axis, report the
    // un-dimensioned counter for context (matches the original
    // pre-refactor behaviour). The derived `remaining*` / `*Percent`
    // fields stay `null` so unlimited-axis rules remain inert.
    if (requestsLimit === null || tokensLimit === null) {
      const fallbackPrefix = `${this.getResourceKeyPrefix(
        workspaceId,
        environmentId,
        resource.resourceId,
        aiConnection.connectionId
      )}:resource-usage:`;
      let fallback = usageByPrefix.get(fallbackPrefix);
      if (!fallback) {
        const baseKey = `${fallbackPrefix}${period}`;
        const [reqOpt, tokOpt] = await Promise.all([
          this.redisClient.client.get(`${baseKey}:requests`),
          this.redisClient.client.get(`${baseKey}:tokens`),
        ]);
        fallback = {
          totalRequests: reqOpt ? parseInt(reqOpt, 10) + 1 : 0,
          usedTokens: tokOpt ? parseInt(tokOpt, 10) : 0,
        };
      }
      if (requestsLimit === null)
        limitingRequestsUsage = fallback.totalRequests;
      if (tokensLimit === null) limitingTokensUsage = fallback.usedTokens;
    }

    const remainingRequests =
      requestsLimit !== null
        ? Math.max(0, requestsLimit - limitingRequestsUsage)
        : null;
    const remainingTokens =
      tokensLimit !== null
        ? Math.max(0, tokensLimit - limitingTokensUsage)
        : null;
    const requestsUsagePercent =
      requestsLimit !== null && requestsLimit > 0
        ? Math.min(100, (limitingRequestsUsage / requestsLimit) * 100)
        : null;
    const tokensUsagePercent =
      tokensLimit !== null && tokensLimit > 0
        ? Math.min(100, (limitingTokensUsage / tokensLimit) * 100)
        : null;

    return {
      totalRequests: limitingRequestsUsage,
      totalTokens: limitingTokensUsage,
      remainingSeconds,
      requestsLimit,
      tokensLimit,
      requestsLimitSource,
      tokensLimitSource,
      remainingRequests,
      remainingTokens,
      requestsUsagePercent,
      tokensUsagePercent,
    };
  }

  private resolveCapacityKeyPrefix(
    capacity: CapacityEntity,
    baseKeyPrefix: string,
    request?: FastifyRequest,
    metadata?: Record<string, string>
  ): { keyPrefix: string; dimensionValue?: string } {
    if (!baseKeyPrefix.endsWith(':')) {
      throw new Error('Base key prefix should end with a colon');
    }

    if (capacity.dimension === CapacityDimension.SOURCE_IP) {
      if (!request) {
        return { keyPrefix: baseKeyPrefix };
      }
      const sourceIp = getSourceIpFromRequest(request);
      return {
        keyPrefix: `${baseKeyPrefix}source-ip:${sourceIp}:`,
        dimensionValue: sourceIp,
      };
    }

    if (capacity.dimension === CapacityDimension.METADATA) {
      const field = capacity.dimensionField;
      // A metadata cap without a configured field name can't be
      // resolved — fall through to the un-dimensioned key so the cap
      // still counts against the global counter rather than silently
      // dropping enforcement.
      if (!field) {
        return { keyPrefix: baseKeyPrefix };
      }
      const value = metadata?.[field] ?? METADATA_DIMENSION_UNKNOWN_VALUE;
      return {
        keyPrefix: `${baseKeyPrefix}metadata:${field}:${value}:`,
        dimensionValue: `${field}=${value}`,
      };
    }

    return { keyPrefix: baseKeyPrefix };
  }

  private getRemainingSecondsByMinute(now: Date) {
    return 60 - now.getSeconds();
  }

  private getRemainingSecondsByHour(now: Date) {
    const secondsPassed = now.getMinutes() * 60 + now.getSeconds();
    const totalSecondsInHour = 3600;
    return totalSecondsInHour - secondsPassed;
  }

  private getRemainingSecondsByDay(now: Date) {
    const startOfNextDay = toZonedTime(new Date(now), 'UTC');
    startOfNextDay.setDate(now.getDate() + 1); // Move to the next day
    startOfNextDay.setHours(0, 0, 0, 0); // First moment of next day

    const diff = startOfNextDay.getTime() - toZonedTime(now, 'UTC').getTime(); // Difference in milliseconds
    const remainingSeconds = Math.floor(diff / 1000); // Convert milliseconds to seconds

    return remainingSeconds;
  }

  private getRemainingSecondsOfWeek(now: Date): number {
    const endDate = toZonedTime(endOfWeek(now), 'UTC');
    endDate.setHours(23, 59, 59, 999); // Last moment of the week

    const diff = endDate.getTime() - toZonedTime(now, 'UTC').getTime(); // Difference in milliseconds
    const remainingSeconds = Math.floor(diff / 1000); // Convert milliseconds to seconds

    return remainingSeconds;
  }

  private getRemainingSecondsOfMonth(): number {
    const now = toZonedTime(new Date(), 'UTC');
    const endDate = endOfMonth(now);
    endDate.setHours(23, 59, 59, 999); // Last moment of the month

    const diff = endDate.getTime() - now.getTime(); // Difference in milliseconds
    const remainingSeconds = Math.floor(diff / 1000); // Convert milliseconds to seconds

    return remainingSeconds;
  }
}
