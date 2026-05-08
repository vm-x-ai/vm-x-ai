import { QueueItem } from './types/QueueItemMetadata';
import { CompletionBatchQueueService } from './batch-queue.service';
import { PinoLogger } from 'nestjs-pino';
import { sleep } from '../../utils/sleep';
import { CompletionBatchItemEntity } from './entity/batch-item.entity';
import { CompletionBatchItemService } from './batch-item-service';
import { PublicCompletionBatchRequestStatus } from '../../storage/entities.generated';
import { CompletionError } from '../completion.types';

const RESOURCES_PER_BATCH = 10;
const MAX_CONCURRENT_TASKS = 1000;

export abstract class CompletionBatchQueueBaseConsumer {
  private pendingTasks: Record<string, Promise<void>> = {};

  constructor(
    protected readonly logger: PinoLogger,
    protected readonly queueService: CompletionBatchQueueService,
    protected readonly completionBatchItemService: CompletionBatchItemService
  ) {
    this.start();
  }

  async start() {
    this.logger.info('Starting completion batch consumer infinite loop');
    while (true) {
      try {
        const pendingTasksCount = Object.keys(this.pendingTasks).length;
        this.logger.info({ pendingTasksCount }, 'Parallel running tasks');
        if (pendingTasksCount >= MAX_CONCURRENT_TASKS) {
          this.logger.info(
            'Max concurrent tasks reached, waiting for some to finish'
          );
          await sleep(1000);
          continue;
        }

        const remainingSlots = MAX_CONCURRENT_TASKS - pendingTasksCount;

        // 1. Get the oldest resources in zset:active:resources (small range)
        // 'ZRANGE' 0 9 sorts ascending by score, which is the earliest timestamp
        this.logger.info('Getting oldest resources');
        const oldestResources = await this.queueService.getOldestResources(
          Math.min(remainingSlots, RESOURCES_PER_BATCH)
        );
        this.logger.info({ oldestResources }, 'Oldest resources fetched');
        if (oldestResources.length === 0) {
          this.logger.info(
            'No resources to process, waiting for new resources'
          );
          await this.queueService.waitForNewResources();
          this.logger.info(
            'Wake up signal received, continuing pulling resources'
          );
          continue;
        }
        this.logger.info({ oldestResources }, 'Processing resources');

        const slotsPerResource = Math.floor(
          remainingSlots / oldestResources.length
        );
        const remainingResourceSlots = remainingSlots % oldestResources.length;

        await Promise.all(
          oldestResources.map(async ([resource], index) => {
            const [workspaceId, environmentId, batchId, resourceId] =
              resource.split('|');
            const lock = await this.queueService.lockResource(
              workspaceId,
              environmentId,
              resourceId
            );
            if (!lock) {
              this.logger.info({ resource }, 'Resource is locked, skipping');
              return;
            }

            /**
             * If it's the first resource, we add the remaining slots to it
             * because the first resource is the oldest one.
             */
            const retrieveCount =
              slotsPerResource + (index === 0 ? remainingResourceSlots : 0);
            this.logger.info(
              {
                workspaceId,
                environmentId,
                resourceId,
                retrieveCount,
              },
              'Retrieving items'
            );

            const items = await this.queueService.retrieveItems(
              workspaceId,
              environmentId,
              resourceId,
              batchId,
              retrieveCount
            );
            await this.queueService.unlockResource(
              workspaceId,
              environmentId,
              resourceId
            );
            if (items.length === 0) {
              return;
            }

            await this.queueService.updateActiveResourceTimestamp(
              workspaceId,
              environmentId,
              batchId,
              resourceId
            );
            for (const item of items) {
              this.pendingTasks[item.payload.itemId] =
                this.processItemHandler(item);
            }
          })
        );

        await sleep(1000);
      } catch (error) {
        this.logger.error({ error }, `Error processing resources ${error}`);
        await sleep(1000);
      }
    }
  }

  async processItemHandler(item: QueueItem<CompletionBatchItemEntity>) {
    try {
      await this.processItem(item);
      this.logger.info({ item }, 'Item processed successfully');
      await this.finishItem(item);
    } catch (error) {
      item.payload = await this.completionBatchItemService.update(
        item.payload.workspaceId,
        item.payload.environmentId,
        item.payload.batchId,
        item.payload.itemId,
        {
          status: PublicCompletionBatchRequestStatus.FAILED,
          errorMessage: (error as Error).message,
          completedAt: new Date(),
        }
      );

      if (error instanceof CompletionError) {
        this.logger.error({ error }, 'Completion error');

        if (error.data.retryable) {
          this.logger.info('Retryable error, moving item to main queue');
          await this.queueService.updateQueueProcessingTimestamp(
            item.payload,
            error.data.retryDelay ?? 0
          );
          return;
        } else {
          this.logger.info('Non-retryable error, skipping');
          await this.finishItem(item);
          return;
        }
      }

      this.logger.error({ error }, 'Not managed error, throwing');
    } finally {
      this.logger.info(
        {
          itemId: item.payload.itemId,
        },
        'Deleting pending task'
      );
      delete this.pendingTasks[item.payload.itemId];
    }
  }

  protected async finishItem(item: QueueItem<CompletionBatchItemEntity>) {
    const completed = await this.queueService.deleteItem(item.payload);
    if (completed) {
      await this.completeBatch(
        item.payload.workspaceId,
        item.payload.environmentId,
        item.payload.batchId
      );
    }
  }

  abstract processItem(
    item: QueueItem<CompletionBatchItemEntity>
  ): Promise<void>;

  abstract completeBatch(
    workspaceId: string,
    environmentId: string,
    batchId: string
  ): Promise<void>;
}
