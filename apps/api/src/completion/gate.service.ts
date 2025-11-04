import { Injectable } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";
import { RedisClient } from "../cache/redis-client";
import { PoolDefinitionService } from "../pool-definition/pool-definition.service";
import { AIConnectionService } from "../ai-connection/ai-connection.service";

export type EvaluatedCapacity = {
  period: CapacityPeriod;
  keyPrefix: string;
};

@Injectable()
export class GateService {
  private prioritizationMetricsRepository: PrioritizationMetricsRepository = new RedisPrioritizationMetricsRepository(
    this.redisClient.client,
  );
  private prioritizationAllocationRepository: PrioritizationAllocationRepository =
    new RedisPrioritizationAllocationRepository(this.redisClient.client);

  constructor(
    private readonly logger: PinoLogger,
    private readonly redisClient: RedisClient,
    private readonly poolDefinitionService: PoolDefinitionService,
    private readonly aiConnectionService: AIConnectionService,
    private readonly capacityService: CapacityService,
  ) {}

  @Span('requestGate')
  public async requestGate(
    grpcMetadata: Metadata,
    workspace: Workspace,
    environmentId: string,
    request: CompletionRequest,
    resource: Resource,
    model: ResourceModelConfig,
    aiConnection: AIConnection,
    provider: ICompletionProvider,
    apiKey?: APIKey,
  ): Promise<EvaluatedCapacity[]> {
    const requestTokens =
      (await provider.getRequestTokens(request, model)) + provider.getMaxReplyTokens(request, model);
    const now = new Date();

    this.logger.debug('Resource config', {
      resource,
      model,
    });

    const { enabledCapacities, connectionCapacities } = this.capacityService.resolve(
      workspace,
      environmentId,
      aiConnection,
      resource,
      apiKey,
      grpcMetadata,
    );

    const startCheckCapacity = Date.now();
    const [poolDefinition, usageMetricsMap] = await Promise.all([
      this.poolDefinitionService.get(workspace.workspaceId, environmentId),
      this.capacityService.getUsage(now, enabledCapacities),
    ]);

    const uniqPeriods = [
      ...new Set(enabledCapacities.map(({ capacity, keyPrefix }) => `${capacity.period}##${keyPrefix}`)),
    ].map((key) => ({
      period: key.split('##')[0] as CapacityPeriod,
      keyPrefix: key.split('##')[1],
    }));

    enabledCapacities.forEach(({ capacity, source, dimensionValue }) =>
      this.checkRequestCapacity(
        capacity,
        source,
        usageMetricsMap[capacity.period].totalRequests,
        usageMetricsMap[capacity.period].usedTokens,
        requestTokens,
        usageMetricsMap[capacity.period].remainingSeconds,
        dimensionValue,
      ),
    );
    this.logger.log('Check capacity duration', {
      duration: Date.now() - startCheckCapacity,
    });

    const pool = poolDefinition?.definition?.find((pool) => pool.resources.includes(request.resource));
    const connectionMinuteCapacity = connectionCapacities.find(
      (capacity) => capacity.period === CapacityPeriod.MINUTE && capacity.enabled,
    );

    if (pool && connectionMinuteCapacity) {
      const prioritizationStartAt = Date.now();
      this.logger.log('Checking prioritization gate', {
        request,
        prioritizationAlgorithm: 'adaptive-token-scaling',
      });
      const prioritizationProvider = new prioritizationAlgorithmMap['adaptive-token-scaling'](
        poolDefinition,
        this.prioritizationMetricsRepository,
        this.prioritizationAllocationRepository,
      );

      const { allowed, reason } = await prioritizationProvider.gate(
        {
          ...request,
          requestTime: now,
          tokens: requestTokens,
        },
        aiConnection,
        {},
      );
      this.logger.log('Prioritization gate duration', {
        duration: Date.now() - prioritizationStartAt,
      });

      if (!allowed) {
        throw new LLMRpcException({
          rate: true,
          message: reason,
          code: status.RESOURCE_EXHAUSTED,
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          retryable: true,
          failureReason: 'Denied by prioritization gate',
        });
      }
    } else {
      this.logger.log('No prioritization gate for the request', {
        request,
        pool,
        connectionMinuteCapacity,
      });
    }

    const increaseRpmTpmCountersStartAt = Date.now();

    const discoveredCapacity = aiConnection.discoveredCapacity?.models[model.model];

    const capacities = [
      ...uniqPeriods,
      ...(discoveredCapacity?.capacity?.map((capacity) => ({
        period: capacity.period,
        source: 'discovered',
        keyPrefix: this.capacityService.getResourceKeyPrefix(
          workspace.workspaceId,
          environmentId,
          resource.resource,
          aiConnection.connectionId,
        ),
      })) ?? []),
    ];

    await Promise.all([
      capacities.map(async ({ period, keyPrefix }) => {
        const key = `${keyPrefix}${period}`;
        await this.increaseRpmTpmCounters(key, usageMetricsMap[period].remainingSeconds, requestTokens);
      }),
    ]);

    this.logger.log('Increase RPM TPM counters duration', {
      duration: Date.now() - increaseRpmTpmCountersStartAt,
    });

    return capacities;
  }

  @Span('decreaseTokenAllocation')
  public async decreaseTokenAllocation(
    evaluatedCapacities: EvaluatedCapacity[],
    request: CompletionRequest,
    response: CompletionResponse,
    model: ResourceModelConfig,
    provider: ICompletionProvider,
  ) {
    const maxTokens = provider.getMaxReplyTokens(request, model);

    await Promise.all(
      evaluatedCapacities.map(async ({ keyPrefix, period }) => {
        const key = `${keyPrefix}${period}`;
        const decreaseBy = maxTokens - response.usage.completion;
        console.log('decreaseBy', decreaseBy);
        await this.redisClient.client.decrby(`${key}:tokens`, decreaseBy);
      }),
    );
  }

  @Span('increaseRpmTpmCounters')
  private async increaseRpmTpmCounters(keyPrefix: string, remainingSeconds: number, tokens: number) {
    // TODO: add local counter to avoid write throughput issue
    const operation = this.redisClient.client
      .multi()
      .incr(`${keyPrefix}:requests`)
      .incrby(`${keyPrefix}:tokens`, tokens);

    if (remainingSeconds > 0) {
      operation
        .expire(`${keyPrefix}:requests`, remainingSeconds - 1)
        .expire(`${keyPrefix}:tokens`, remainingSeconds - 1);
    }

    console.log('operation', keyPrefix, tokens);

    await operation.exec();
  }

  @Span('checkRequestCapacity')
  private checkRequestCapacity(
    capacity: Capacity,
    capacityResource: string,
    totalRequests: number,
    usedTokens: number,
    requestTokens: number,
    remainingSeconds: number,
    capacityDimensionValue?: string,
  ) {
    let prefixMessage = 'Resource';
    if (capacity.dimension && capacityDimensionValue) {
      switch (capacity.dimension) {
        case CapacityDimension.SOURCE_IP:
          prefixMessage = `Source IP ${capacityDimensionValue}`;
          break;
      }
    }

    if (capacity.requests > 0 && totalRequests > capacity.requests) {
      throw new LLMRpcException({
        rate: true,
        message: `${prefixMessage} has reached the limit of requests, limit: ${capacity.requests} at ${capacityResource} level by ${capacity.period}`,
        code: status.RESOURCE_EXHAUSTED,
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        retryable: true,
        retryDelay: remainingSeconds > 0 ? remainingSeconds * 1000 : undefined,
        failureReason: `${capacityResource}: Resource has reached the limit of requests`,
      });
    }

    const totalTokens = usedTokens + requestTokens;
    if (capacity.tokens > 0 && totalTokens > capacity.tokens) {
      throw new LLMRpcException({
        rate: true,
        message: `${prefixMessage} has reached the limit of tokens, limit: ${capacity.tokens} at ${capacityResource} level by ${capacity.period}`,
        code: status.RESOURCE_EXHAUSTED,
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        retryable: true,
        retryDelay: remainingSeconds > 0 ? remainingSeconds * 1000 : undefined,
        failureReason: `${capacityResource}: Resource has reached the limit of tokens`,
      });
    }

    this.logger.log('Resource usage', {
      totalRequests,
      totalTokens,
    });
  }
}
