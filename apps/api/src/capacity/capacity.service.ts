import { Injectable } from '@nestjs/common';
import { CapacityEntity, CapacityPeriod } from './capacity.entity';
import { PinoLogger } from 'nestjs-pino';
import { RedisClient } from '../cache/redis-client';
import { WorkspaceEntity } from '../workspace/entities/workspace.entity';
import { AIConnectionEntity } from '../ai-connection/entities/ai-connection.entity';
import { AIResourceEntity } from '../ai-resource/entities/ai-resource.entity';
import type { FastifyRequest } from 'fastify';

type PrefixedCapacity = {
  capacity: CapacityEntity;
  keyPrefix: string;
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
    workspace: WorkspaceEntity,
    environmentId: string,
    aiConnection: AIConnectionEntity,
    resource: AIResourceEntity,
    req: FastifyRequest,
    apiKey?: APIKey,
  ) {
    const resourceKeyPrefix = this.getResourceKeyPrefix(
      workspace.workspaceId,
      environmentId,
      resource.resource,
      aiConnection.connectionId
    );
    const connectionCapacities = aiConnection.capacity.filter((u) => u.enabled);
    if (connectionCapacities.length === 0) {
      this.logger.log('No resource limit for the resource', {
        resource: resource.resource,
      });
    }

    const enabledCapacities = [
      ...connectionCapacities.map((capacity) => {
        const keyPrefixAttributes = this.resolveCapacityKeyPrefix(
          capacity,
          `${resourceKeyPrefix}:resource-usage:`,
          grpcMetadata
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
          grpcMetadata
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
          grpcMetadata
        );

        return {
          ...keyPrefixAttributes,
          capacity,
          source: 'API Key',
        };
      }),
      ...(workspace.plan?.quota ?? []).map((capacity) => {
        const keyPrefixAttributes = this.resolveCapacityKeyPrefix(
          capacity,
          `workspace:{${workspace.workspaceId}}:usage:`,
          grpcMetadata
        );

        return {
          ...keyPrefixAttributes,
          capacity,
          source: 'Quota',
        };
      }),
    ].filter(({ capacity }) => capacity.enabled);

    return { enabledCapacities, connectionCapacities };
  }

  private resolveCapacityKeyPrefix(
    capacity: Capacity,
    baseKeyPrefix: string,
    grpcMetadata?: Metadata
  ): { keyPrefix: string; dimensionValue?: string } {
    if (!baseKeyPrefix.endsWith(':')) {
      throw new Error('Base key prefix should end with a colon');
    }

    if (capacity.dimension === 'source-ip') {
      const sourceIp = getSourceIpFromGrcpMetadata(grpcMetadata);
      return {
        keyPrefix: `${baseKeyPrefix}source-ip:${getSourceIpFromGrcpMetadata(
          grpcMetadata
        )}:`,
        dimensionValue: sourceIp,
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
