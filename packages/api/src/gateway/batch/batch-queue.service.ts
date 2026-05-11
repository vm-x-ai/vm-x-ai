import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isAfter, subDays } from 'date-fns';
import dedent from 'string-dedent';
import { QueueItem } from './types/QueueItemMetadata';
import { CompletionBatchStream } from './types/stream';
import { RedisClient } from '../../cache/redis-client';
import { AIResourceService } from '../../ai-resource/ai-resource.service';
import { AIConnectionService } from '../../ai-connection/ai-connection.service';
import { CapacityService } from '../../capacity/capacity.service';
import { sleep } from '../../utils/sleep';
import { CompletionBatchItemEntity } from './entity/batch-item.entity';
import { CompletionBatchEntity } from './entity/batch.entity';
import { PublicCompletionBatchRequestStatus } from '../../storage/entities.generated';
import os from 'os';
import { PinoLogger } from 'nestjs-pino';
import { ApiKeyEntity } from '../../api-key/entities/api-key.entity';
import { ApiKeyService } from '../../api-key/api-key.service';

const RESOURCE_LOOK_MS = 10000;
const REPROCESS_LOOP_MAX_FETCH_ITEMS = 100;
@Injectable()
export class CompletionBatchQueueService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly redis: RedisClient,
    private readonly configService: ConfigService,
    private readonly aiResourceService: AIResourceService,
    private readonly aiConnectionService: AIConnectionService,
    private readonly capacityService: CapacityService,
    private readonly apiKeyService: ApiKeyService
  ) {
    this.reprocessLoop();
    this.standbyResourcesLoop();
  }

  private readonly queueKeyPrefix = 'completion-batch';

  private async reprocessLoop() {
    this.logger.info('Starting reprocess infinite loop');
    while (true) {
      try {
        const fetchItemsLua = dedent`
        local globalProcessingQueue = KEYS[1]
        local limit = tonumber(ARGV[1])
        local now = tonumber(ARGV[2])

        local expired = redis.call('ZRANGEBYSCORE', globalProcessingQueue, 0, now, 'LIMIT', 0, limit)

        for i, itemId in ipairs(expired) do
          -- Remove from global in-flight index
          redis.call('ZREM', globalProcessingQueue, itemId)
        end

        return expired
        `;

        const expired = (await this.redis.client.eval(
          fetchItemsLua,
          1,
          this.globalProcessingQueueKey(),
          REPROCESS_LOOP_MAX_FETCH_ITEMS,
          Date.now()
        )) as string[];

        if (expired.length === 0) {
          await sleep(1000);
          continue;
        }

        const startAt = Date.now();
        await Promise.all(
          expired.map(async (item) => {
            this.logger.info(`Reprocessing item ${item}`);
            const [workspaceId, environmentId, batchId, itemId, resourceId] =
              item.split('|');
            const baseKey = this.baseKey(workspaceId, environmentId);
            const payloadKey = this.queueItemPayloadKey(
              workspaceId,
              environmentId,
              batchId,
              itemId,
              resourceId
            );
            const mainQueue = this.queueKey(baseKey, resourceId);
            const processingQueue = this.processingQueueKey(
              baseKey,
              resourceId
            );

            const payload = await this.redis.client.hgetall(payloadKey);

            const [timestampResult] = (await this.redis.client
              .multi()
              .zscore(processingQueue, item)
              .zrem(processingQueue, item)
              .zadd(mainQueue, payload.timestamp, item)
              .hincrby(payloadKey, 'retryCount', 1)
              .exec()) as [Error | null, number | null][];

            const activeResourceMember = this.activeResourcesMember(
              workspaceId,
              environmentId,
              batchId,
              resourceId
            );
            const added = await this.updateActiveResourceTimestamp(
              workspaceId,
              environmentId,
              batchId,
              resourceId
            );
            if (added) {
              this.logger.info(
                `Adding resource ${resourceId} to new resources stream, waking up workers`
              );
              await this.sendActiveResourceEvent(activeResourceMember);
            }

            if (Number(timestampResult[1]) < Date.now() - 5000) {
              this.logger.warn(`The item is late by more than 5 seconds`, {
                item,
                timestamp: timestampResult[1],
                now: Date.now(),
                delay: Date.now() - Number(timestampResult[1]),
              });
            }
          })
        );
        this.logger.info(
          `Reprocessed ${expired.length} items in ${Date.now() - startAt}ms`
        );

        await sleep(1000);
      } catch (error) {
        this.logger.error(
          `Error in reprocess loop, ${(error as Error).message}`,
          error
        );
      }
    }
  }

  private async standbyResourcesLoop() {
    this.logger.info('Starting standby resources infinite loop');
    while (true) {
      try {
        const expireScriptLua = dedent`
        local standbyResourcesBatch = KEYS[1]
        local activeResourcesBatch = KEYS[2]
        local newResourcesStream = KEYS[3]
        local limit = tonumber(ARGV[1])
        local now = tonumber(ARGV[2])

        local expired = redis.call('ZRANGEBYSCORE', standbyResourcesBatch, 0, now, 'LIMIT', 0, limit)

        for i, itemId in ipairs(expired) do
          -- Remove from global in-flight index
          redis.call('ZREM', standbyResourcesBatch, itemId)
          redis.call('ZADD', activeResourcesBatch, now, itemId)
          redis.call('XADD', newResourcesStream, '*', 'workspaceEnvironmentResourceId', itemId)
        end

        return expired
        `;

        const expired = (await this.redis.client.eval(
          expireScriptLua,
          3,
          this.standbyResourcesBatchKey(),
          this.globalActiveResourcesKey(),
          this.globalNewResourcesStreamKey(),
          REPROCESS_LOOP_MAX_FETCH_ITEMS,
          Date.now()
        )) as string[];

        if (expired.length !== 0) {
          this.logger.info(
            `Moved ${expired.length} items from standby to active resources`
          );
        }

        await sleep(1000);
      } catch (error) {
        this.logger.error(
          `Error in standby resources loop, ${(error as Error).message}`,
          error
        );
      }
    }
  }

  public baseKey(workspaceId: string, environmentId: string) {
    return `${this.queueKeyPrefix}:{${workspaceId}:${environmentId}`;
  }

  public queueKey(baseKey: string, resourceId: string) {
    return `${baseKey}:${resourceId}}:queue`;
  }

  public processingQueueKey(baseKey: string, resourceId: string) {
    return `${baseKey}:${resourceId}}:processing-queue`;
  }

  public batchQueueStreamKey(baseKey: string, batchId: string) {
    return `${baseKey}:${batchId}}:batch-queue-stream`;
  }

  public queueItemPayloadKey(
    workspaceId: string,
    environmentId: string,
    batchId: string,
    itemId: string,
    resourceId: string
  ) {
    return `${this.queueKeyPrefix}:{${workspaceId}:${environmentId}:${resourceId}}:item-payload:${batchId}:${itemId}`;
  }

  public resourceLockKey(baseKey: string, resourceId: string) {
    return `${baseKey}:${resourceId}}:resource-lock`;
  }

  public batchKey(baseKey: string, batchId: string) {
    return `${baseKey}:${batchId}}:batch`;
  }

  public globalProcessingQueueKey() {
    return `{${this.queueKeyPrefix}}:global-processing-queue`;
  }

  public standbyResourcesBatchKey() {
    return `{${this.queueKeyPrefix}}:standby-resources-batch`;
  }

  public globalActiveResourcesKey() {
    return `{${this.queueKeyPrefix}}:active-resources-batch`;
  }

  public globalNewResourcesStreamKey() {
    return `{${this.queueKeyPrefix}}:new-resources-batch`;
  }

  public activeResourcesMember(
    workspaceId: string,
    environmentId: string,
    batchId: string,
    resourceId: string
  ) {
    return `${workspaceId}|${environmentId}|${batchId}|${resourceId}`;
  }

  private getItemMemberId(item: CompletionBatchItemEntity) {
    return `${item.workspaceId}|${item.environmentId}|${item.batchId}|${
      item.itemId
    }|${item.resourceId}|${new Date(item.createdAt).getTime()}|${
      item.estimatedPromptTokens
    }`;
  }

  async getBatch(
    workspaceId: string,
    environmentId: string,
    batchId: string
  ): Promise<CompletionBatchEntity> {
    const baseKey = this.baseKey(workspaceId, environmentId);
    const batchKey = this.batchKey(baseKey, batchId);
    const batch = await this.redis.client.hgetall(batchKey);
    const result = JSON.parse(batch.payload) as CompletionBatchEntity;

    return {
      ...result,
      completed: parseInt(batch.completed),
      failed: parseInt(batch.failed),
      pending: parseInt(batch.pending),
    };
  }

  async getBatchStatus(
    workspaceId: string,
    environmentId: string,
    batchId: string
  ) {
    const baseKey = this.baseKey(workspaceId, environmentId);
    const batchKey = this.batchKey(baseKey, batchId);
    const status = await this.redis.client.hget(batchKey, 'status');
    return status as PublicCompletionBatchRequestStatus;
  }

  async updateBatchStatus(
    batch: CompletionBatchEntity,
    status: PublicCompletionBatchRequestStatus
  ) {
    const baseKey = this.baseKey(batch.workspaceId, batch.environmentId);
    const batchKey = this.batchKey(baseKey, batch.batchId);
    await this.redis.client.hset(batchKey, 'status', status);

    if (
      [
        PublicCompletionBatchRequestStatus.COMPLETED,
        PublicCompletionBatchRequestStatus.FAILED,
      ].includes(status)
    ) {
      const streamKey = this.batchQueueStreamKey(baseKey, batch.batchId);
      await this.redis.client.xadd(
        streamKey,
        '*',
        'payload',
        JSON.stringify({
          action:
            status === PublicCompletionBatchRequestStatus.COMPLETED
              ? 'batch-completed'
              : 'batch-failed',
          payload: {
            ...batch,
            status,
          },
        })
      );

      await this.redis.client.expire(streamKey, 30);
    }
  }

  async sendBatch(
    batch: CompletionBatchEntity,
    items: CompletionBatchItemEntity[]
  ) {
    const resourceItems = items.reduce<
      Record<string, CompletionBatchItemEntity[]>
    >((acc, item) => {
      return {
        ...acc,
        [item.resourceId]: [...(acc[item.resourceId] ?? []), item],
      };
    }, {});

    const baseKey = this.baseKey(batch.workspaceId, batch.environmentId);

    this.logger.info(`Sending batch for ${items.length} items`);
    const batchKey = this.batchKey(baseKey, batch.batchId);
    await this.redis.client
      .multi()
      .hset(batchKey, 'pending', items.length)
      .hset(batchKey, 'timestamp', batch.timestamp.toISOString())
      .hset(batchKey, 'payload', JSON.stringify(batch))
      .hset(batchKey, 'status', batch.status)
      .expire(batchKey, 60 * 60 * 24 * 7) // 1 week
      .exec();

    const streamKey = this.batchQueueStreamKey(baseKey, batch.batchId);
    await this.redis.client.xadd(
      streamKey,
      '*',
      'payload',
      JSON.stringify({ action: 'batch-created', payload: batch })
    );

    await Promise.all(
      Object.entries(resourceItems).map(async ([resource, items]) => {
        this.logger.info(
          `Sending batch for resource ${resource} with ${items.length} items`
        );
        await Promise.all(
          items.map(async (item) => {
            const queueMember = this.getItemMemberId(item);
            const timestamp = new Date(item.createdAt).getTime();
            const payloadKey = this.queueItemPayloadKey(
              item.workspaceId,
              item.environmentId,
              batch.batchId,
              item.itemId,
              item.resourceId
            );
            await this.redis.client
              .multi()
              .zadd(this.queueKey(baseKey, resource), timestamp, queueMember)
              .hset(payloadKey, 'payload', JSON.stringify(item))
              .hset(payloadKey, 'timestamp', timestamp)
              .hset(payloadKey, 'retryCount', 0)
              .hset(
                payloadKey,
                'processingQueue',
                this.processingQueueKey(baseKey, resource)
              )
              .hset(payloadKey, 'mainQueue', this.queueKey(baseKey, resource))
              .hset(
                payloadKey,
                'workspaceEnvironmentResourceId',
                this.activeResourcesMember(
                  batch.workspaceId,
                  batch.environmentId,
                  batch.batchId,
                  resource
                )
              )
              .exec();
          })
        );

        this.logger.info(
          `Sent batch for resource ${resource} with ${items.length} items`
        );
        this.logger.info(`Adding resource ${resource} to active resources`);
        const activeResourceMember = this.activeResourcesMember(
          batch.workspaceId,
          batch.environmentId,
          batch.batchId,
          resource
        );
        const added = await this.redis.client.zadd(
          this.globalActiveResourcesKey(),
          'NX',
          Date.now(),
          activeResourceMember
        );
        if (added) {
          this.logger.info(
            `Adding resource ${resource} to new resources stream, waking up workers`
          );
          await this.sendActiveResourceEvent(activeResourceMember);
        }
      })
    );
  }

  private async sendActiveResourceEvent(activeResourceMember: string) {
    await this.redis.client.xadd(
      this.globalNewResourcesStreamKey(),
      '*',
      'workspaceEnvironmentResourceId',
      activeResourceMember
    );
  }

  async getOldestResources(count: number): Promise<[string, string][]> {
    const resourcesWithScores = await this.redis.client.zrange(
      this.globalActiveResourcesKey(),
      0,
      count - 1,
      'WITHSCORES'
    );

    const result: [string, string][] = [];
    for (let i = 0; i < resourcesWithScores.length; i += 2) {
      result.push([resourcesWithScores[i], resourcesWithScores[i + 1]]);
    }

    return result;
  }

  async *listenToBatchEvents(
    workspaceId: string,
    environmentId: string,
    batchId: string
  ): AsyncIterable<CompletionBatchStream> {
    const baseKey = this.baseKey(workspaceId, environmentId);
    const streamKey = this.batchQueueStreamKey(baseKey, batchId);

    await this.initStreamGroup(streamKey);
    const workerId = this.configService.get<string>('ecs.TaskId');

    const redisConnection = this.redis.client.duplicate();

    try {
      while (true) {
        try {
          const result = (await redisConnection.xreadgroup(
            'GROUP',
            'workersGroup',
            `worker-${workerId}`,
            'COUNT',
            10,
            'BLOCK',
            0,
            'STREAMS',
            streamKey,
            '>'
          )) as [string, [string, string[]][]][];

          if (result) {
            for (const [, messages] of result) {
              for (const [messageId, [, data]] of messages) {
                const event = JSON.parse(data) as CompletionBatchStream;
                yield event;
                await redisConnection.xack(
                  streamKey,
                  'workersGroup',
                  messageId
                );

                if (
                  event.action === 'batch-completed' ||
                  event.action === 'batch-failed'
                ) {
                  this.logger.info(
                    `Batch ${batchId} has no pending items to process, completing`
                  );
                  return;
                }
              }
            }
          }

          await sleep(1000);
        } catch (error) {
          if ((error as Error).message.includes('NOGROUP No such key')) {
            this.logger.info(
              `The batch ${batchId} has no pending items to process, returning`
            );
            return;
          }

          throw error;
        }
      }
    } catch (error) {
      this.logger.error(
        `Error on reading new events for batch ${batchId}, ${
          (error as Error).message
        }`,
        error
      );
      throw error;
    } finally {
      await redisConnection.quit();
    }
  }

  async waitForNewResources() {
    // Use XREADGROUP for distributing wake-ups across ECS tasks
    const workerId = this.configService.get<string>('ecs.TaskId');
    await this.initStreamGroup(this.globalNewResourcesStreamKey());

    const streamKey = this.globalNewResourcesStreamKey();
    const result = (await this.redis.streamClient.xreadgroup(
      'GROUP',
      'workersGroup',
      `worker-${workerId}`,
      'COUNT',
      1,
      'BLOCK',
      0,
      'STREAMS',
      streamKey,
      '>'
    )) as [string, [string, string][]][];

    // Immediately XACK since it's only a wake-up signal
    if (result) {
      for (const [, messages] of result) {
        for (const [messageId] of messages) {
          await this.redis.streamClient.xack(
            streamKey,
            'workersGroup',
            messageId
          );
        }
      }
    }
  }

  async lockResource(
    workspaceId: string,
    environmentId: string,
    resourceId: string
  ) {
    const baseKey = this.baseKey(workspaceId, environmentId);
    const key = this.resourceLockKey(baseKey, resourceId);
    const instanceId = os.hostname();
    const lock = await this.redis.client
      .multi()
      .set(key, instanceId, 'PX', RESOURCE_LOOK_MS, 'NX')
      .get(key)
      .exec();

    return lock?.[1][1] === instanceId;
  }

  async unlockResource(
    workspaceId: string,
    environmentId: string,
    resourceId: string
  ) {
    const baseKey = this.baseKey(workspaceId, environmentId);
    const key = this.resourceLockKey(baseKey, resourceId);
    await this.redis.client.del(key);
  }

  async retrieveItems(
    workspaceId: string,
    environmentId: string,
    resourceId: string,
    batchId: string,
    count: number
  ): Promise<QueueItem<CompletionBatchItemEntity>[]> {
    const [resource, batch] = await Promise.all([
      this.aiResourceService.getById({
        workspaceId,
        environmentId,
        resourceId,
        includesUsers: false,
      }),
      this.getBatch(workspaceId, environmentId, batchId),
    ]);
    const connection = await this.aiConnectionService.getById({
      workspaceId,
      environmentId,
      // The resource is loaded from `aiResources`; the row schema +
      // `AIResourceService.create/update` resolver pin `connectionId`
      // to a UUID before persisting, so it's always defined here.
      connectionId: resource.model.connectionId as string,
      decrypt: true,
    });
    let apiKey: ApiKeyEntity | undefined;
    if (batch.createdByApiKeyId) {
      apiKey = await this.apiKeyService.getById({
        workspaceId,
        environmentId,
        apiKeyId: batch.createdByApiKeyId,
        includesUsers: false,
      });
    }

    const capacity = [
      ...this.capacityService.resolve(
        workspaceId,
        environmentId,
        connection,
        resource
      ).enabledCapacities,
      ...(batch.capacity ?? []).map((capacity) => ({
        capacity,
        source: 'batch',
        keyPrefix: this.capacityService.getResourceKeyPrefix(
          workspaceId,
          environmentId,
          resourceId,
          connection.connectionId
        ),
      })),
    ];

    const now = new Date();

    const discoveredCapacity =
      connection.discoveredCapacity?.models?.[resource.model.model];
    if (discoveredCapacity && discoveredCapacity.capacity) {
      const updatedAt = new Date(discoveredCapacity.updatedAt);
      const diff = subDays(now, 7);
      if (isAfter(updatedAt, diff)) {
        capacity.push(
          ...discoveredCapacity.capacity.map((capacity) => ({
            capacity,
            source: 'discovered',
            keyPrefix: this.capacityService.getResourceKeyPrefix(
              workspaceId,
              environmentId,
              resourceId,
              connection.connectionId
            ),
          }))
        );
      }
    }

    const usageMetrics = await this.capacityService.getUsage(now, capacity);

    let availableRequests = Infinity;
    let availableTokens = Infinity;
    let remainingSeconds = Infinity;
    for (const item of capacity) {
      const remainingRequests =
        (item.capacity.requests ?? 0) > 0
          ? (item.capacity.requests ?? 0) -
            usageMetrics[item.capacity.period].totalRequests
          : Infinity;
      const remainingTokens =
        (item.capacity.tokens ?? 0) > 0
          ? (item.capacity.tokens ?? 0) -
            usageMetrics[item.capacity.period].usedTokens
          : Infinity;
      const seconds = usageMetrics[item.capacity.period].remainingSeconds;
      if (seconds < remainingSeconds) {
        remainingSeconds = seconds;
      }

      if (remainingRequests < 0 || remainingTokens < 0) {
        await this.moveBatchToStandby(
          batchId,
          workspaceId,
          environmentId,
          resourceId,
          now,
          seconds * 1000
        );
        return [];
      }

      if (remainingRequests < availableRequests) {
        availableRequests = remainingRequests;
      }

      if (remainingTokens < availableTokens) {
        availableTokens = remainingTokens;
      }
    }

    const retrieveItemsLua = dedent`
    local mainQueue = KEYS[1]
    local processingQueue = KEYS[2]
    local maxToRetrieve = tonumber(ARGV[1])
    local maxTokens = tonumber(ARGV[2])
    local now = tonumber(ARGV[3])
    local visibilityTimeout = tonumber(ARGV[4])

    local itemsIds = redis.call('ZRANGE', mainQueue, 0, maxToRetrieve - 1)
    local totalTokens = 0
    local finalItemsIds = {}

    for i, itemId in ipairs(itemsIds) do
        local parts = {}
        for part in string.gmatch(itemId, "([^|]+)") do
            table.insert(parts, part)
        end
        local requestTokens = tonumber(parts[7])
        totalTokens = totalTokens + requestTokens

        if totalTokens > maxTokens then
            break
        end

        table.insert(finalItemsIds, itemId)
        redis.call('ZREM', mainQueue, itemId)
        redis.call('ZADD', processingQueue, now + visibilityTimeout, itemId)
    end

    return { finalItemsIds, itemsIds }
    `;

    const baseKey = this.baseKey(workspaceId, environmentId);
    const mainQueue = this.queueKey(baseKey, resourceId);
    const processingQueue = this.processingQueueKey(baseKey, resourceId);
    const globalProcessingQueue = this.globalProcessingQueueKey();

    this.logger.info(
      {
        batchId,
        workspaceId,
        environmentId,
        resourceId,
        maxToRetrieve: Math.min(count, availableRequests),
        mainQueue,
        processingQueue,
        globalProcessingQueue,
        availableRequests,
        availableTokens,
      },
      `Trying to retrieve ${count} items from ${mainQueue}`
    );
    const visibilityTimeout = this.configService.getOrThrow<number>(
      'BATCH_QUEUE_VISIBILITY_TIMEOUT'
    );

    const [itemIdsWithTimestamp, itemsIds] = (await this.redis.client.eval(
      retrieveItemsLua,
      2,
      mainQueue,
      processingQueue,
      Math.min(count, availableRequests),
      availableTokens,
      now.getTime(),
      visibilityTimeout
    )) as [string[], string[], number];

    if (itemIdsWithTimestamp.length === 0 && itemsIds.length > 0) {
      await this.moveBatchToStandby(
        batchId,
        workspaceId,
        environmentId,
        resourceId,
        now,
        remainingSeconds * 1000
      );
      return [];
    }

    if (itemIdsWithTimestamp.length === 0) {
      this.logger.info(
        `No items to retrieve from ${mainQueue}, removing resource from active resources`
      );
      const result = await this.deleteBatchResourceFromActiveResources(
        workspaceId,
        environmentId,
        batchId,
        resourceId
      );
      this.logger.info(`Removed resource from active resources`, result);
      return [];
    }

    this.logger.info(
      `Retrieved ${itemIdsWithTimestamp.length} items from ${mainQueue}`
    );
    const globalProcessingQueueCommander = this.redis.client.multi();
    for (const itemIdWithTimestamp of itemIdsWithTimestamp) {
      globalProcessingQueueCommander.zadd(
        globalProcessingQueue,
        now.getTime() + visibilityTimeout,
        itemIdWithTimestamp
      );
    }

    await globalProcessingQueueCommander.exec();

    const chainCommander = this.redis.client.multi();
    for (const itemIdWithTimestamp of itemIdsWithTimestamp) {
      const [workspaceId, environmentId, batchId, itemId, resourceId] =
        itemIdWithTimestamp.split('|');
      const payloadKey = this.queueItemPayloadKey(
        workspaceId,
        environmentId,
        batchId,
        itemId,
        resourceId
      );
      chainCommander
        .hget(payloadKey, 'payload')
        .hget(payloadKey, 'retryCount')
        .hget(payloadKey, 'timestamp');
    }

    const redisResult = await chainCommander.exec();
    const items: QueueItem<CompletionBatchItemEntity>[] = [];
    if (redisResult) {
      for (let i = 0; i < redisResult.length; i += 3) {
        const payload = JSON.parse(redisResult[i][1] as string);
        const retryCount = parseInt(redisResult[i + 1][1] as string);
        const timestamp = parseInt(redisResult[i + 2][1] as string);

        items.push({
          payload,
          metadata: {
            retryCount,
            createdAt: timestamp,
          },
          context: {
            batch,
            apiKey,
          },
        });
      }
    }

    return items;
  }

  private async moveBatchToStandby(
    batchId: string,
    workspaceId: string,
    environmentId: string,
    resourceId: string,
    now: Date,
    delay: number
  ) {
    this.logger.info(
      `No available requests or tokens, skipping batch ${batchId} and adding to standby resources to ${delay}ms`
    );
    const key = this.activeResourcesMember(
      workspaceId,
      environmentId,
      batchId,
      resourceId
    );
    await this.redis.client
      .multi()
      .zadd(this.standbyResourcesBatchKey(), 'NX', now.getTime() + delay, key)
      .zrem(this.globalActiveResourcesKey(), key)
      .exec();
  }

  async deleteItem(item: CompletionBatchItemEntity): Promise<boolean> {
    const baseKey = this.baseKey(item.workspaceId, item.environmentId);
    const queueMember = this.getItemMemberId(item);

    const payloadKey = this.queueItemPayloadKey(
      item.workspaceId,
      item.environmentId,
      item.batchId,
      item.itemId,
      item.resourceId
    );
    const processingQueue = this.processingQueueKey(baseKey, item.resourceId);
    const globalProcessingQueue = this.globalProcessingQueueKey();
    const batchKey = this.batchKey(baseKey, item.batchId);

    const [result] = await Promise.all([
      this.redis.client
        .multi()
        .hincrby(batchKey, 'pending', -1)
        .hincrby(
          batchKey,
          'completed',
          item.status === PublicCompletionBatchRequestStatus.COMPLETED ? 1 : 0
        )
        .hincrby(
          batchKey,
          'failed',
          item.status === PublicCompletionBatchRequestStatus.FAILED ? 1 : 0
        )
        .exec(),
      this.redis.client
        .multi()
        .del(payloadKey)
        .zrem(processingQueue, queueMember)
        .exec(),
      this.redis.client.zrem(globalProcessingQueue, queueMember),
      this.redis.client.xadd(
        this.batchQueueStreamKey(baseKey, item.batchId),
        '*',
        'payload',
        JSON.stringify({
          action:
            item.status === PublicCompletionBatchRequestStatus.COMPLETED
              ? 'item-completed'
              : 'item-failed',
          payload: item,
        })
      ),
    ]);

    return result?.[0][1] === 0;
  }

  async updateQueueProcessingTimestamp(
    item: CompletionBatchItemEntity,
    delay = 0
  ) {
    const timestamp = Date.now() + delay;
    const baseKey = this.baseKey(item.workspaceId, item.environmentId);
    const processingKey = this.processingQueueKey(baseKey, item.resourceId);
    const globalProcessingKey = this.globalProcessingQueueKey();
    const queueMember = this.getItemMemberId(item);

    await Promise.all([
      this.redis.client.zadd(processingKey, 'XX', timestamp, queueMember),
      this.redis.client.zadd(globalProcessingKey, 'XX', timestamp, queueMember),
    ]);
  }

  async updateActiveResourceTimestamp(
    workspaceId: string,
    environmentId: string,
    batchId: string,
    resourceId: string
  ) {
    const key = this.globalActiveResourcesKey();
    const member = this.activeResourcesMember(
      workspaceId,
      environmentId,
      batchId,
      resourceId
    );
    return await this.redis.client.zadd(key, 'LT', Date.now(), member);
  }

  async deleteBatchResourceFromActiveResources(
    workspaceId: string,
    environmentId: string,
    batchId: string,
    resourceId: string
  ) {
    return await this.redis.client.zrem(
      this.globalActiveResourcesKey(),
      this.activeResourcesMember(
        workspaceId,
        environmentId,
        batchId,
        resourceId
      )
    );
  }

  async deleteBatchFromActiveResources(
    workspaceId: string,
    environmentId: string,
    batchId: string
  ) {
    let cursor = '0';
    while (cursor !== '0') {
      const [nextCursor, keys] = await this.redis.client.zscan(
        this.globalActiveResourcesKey(),
        cursor,
        'MATCH',
        `${workspaceId}:${environmentId}:${batchId}:*`,
        'COUNT',
        1000
      );
      cursor = nextCursor;
      await this.redis.client.zrem(this.globalActiveResourcesKey(), ...keys);
    }
  }

  private async initStreamGroup(key: string) {
    try {
      this.logger.info(`Initializing stream group`);
      await this.redis.client.xgroup(
        'CREATE',
        key,
        'workersGroup',
        '0',
        'MKSTREAM'
      );
      this.logger.info(`Stream group initialized`);
    } catch (error) {
      this.logger.info(`Stream group already initialized`);
      // Ignore error if group already exists
      if (!(error as Error).message.includes('BUSYGROUP')) {
        throw error;
      }
    }
  }
}
