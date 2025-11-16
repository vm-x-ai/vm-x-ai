import { Injectable } from '@nestjs/common';
import axios from 'axios';
import axiosRetry from 'axios-retry';
import { QueueItem } from './types/QueueItemMetadata';
import { CompletionBatchQueueBaseConsumer } from './batch-queue.base-consumer';
import { CompletionBatchQueueService } from './batch-queue.service';
import { CompletionBatchService } from './batch-service';
import { PinoLogger } from 'nestjs-pino';
import { CompletionBatchItemService } from './batch-item-service';
import { CompletionService } from '../completion.service';
import { CompletionBatchItemEntity } from './entity/batch-item.entity';
import {
  PublicCompletionBatchRequestStatus,
  PublicCompletionBatchRequestType,
} from '../../storage/entities.generated';
import { CompletionBatchCallbackEvent } from './dto/callback-options.dto';
import { CompletionBatchDto } from './dto/batch.dto';

@Injectable()
export class CompletionBatchQueueConsumer extends CompletionBatchQueueBaseConsumer {
  constructor(
    logger: PinoLogger,
    queueService: CompletionBatchQueueService,
    completionBatchItemService: CompletionBatchItemService,
    private readonly completionService: CompletionService,
    private readonly completionBatchService: CompletionBatchService
  ) {
    super(logger, queueService, completionBatchItemService);
  }

  async processItem(item: QueueItem<CompletionBatchItemEntity>) {
    this.logger.info({ item }, 'Processing item');
    if (item.metadata.retryCount === 0) {
      await this.completionBatchService.incrementCounters(
        item.payload.workspaceId,
        item.payload.environmentId,
        item.payload.batchId,
        {
          pending: -1,
          running: 1,
        }
      );
    }

    item.payload = await this.completionBatchItemService.update(
      item.payload.workspaceId,
      item.payload.environmentId,
      item.payload.batchId,
      item.payload.itemId,
      {
        status: PublicCompletionBatchRequestStatus.RUNNING,
        retryCount: item.payload.retryCount,
        errorMessage: null,
      }
    );

    const completionResponse = await this.completionService.completion(
      item.payload.workspaceId,
      item.payload.environmentId,
      item.payload.resource,
      {
        ...item.payload.request,
        stream: false,
        vmx: { correlationId: item.payload.batchId },
      },
      item.context.apiKey,
      undefined,
      item.context.batch
    );

    item.payload = await this.completionBatchItemService.update(
      item.payload.workspaceId,
      item.payload.environmentId,
      item.payload.batchId,
      item.payload.itemId,
      {
        status: PublicCompletionBatchRequestStatus.COMPLETED,
        response: completionResponse,
        completedAt: new Date(),
        completionTokens:
          completionResponse.data?.usage?.completion_tokens ?? 0,
        promptTokens: completionResponse.data?.usage?.prompt_tokens ?? 0,
        totalTokens: completionResponse.data?.usage?.total_tokens ?? 0,
      }
    );

    if (completionResponse.data?.usage) {
      await this.completionBatchService.incrementCounters(
        item.payload.workspaceId,
        item.payload.environmentId,
        item.payload.batchId,
        {
          totalCompletionTokens:
            completionResponse.data.usage.completion_tokens,
          totalPromptTokens: completionResponse.data.usage.prompt_tokens,
        }
      );
    }
  }

  override async completeBatch(
    workspaceId: string,
    environmentId: string,
    batchId: string
  ): Promise<void> {
    const batch = await this.queueService.getBatch(
      workspaceId,
      environmentId,
      batchId
    );

    this.logger.info({ batch }, 'Completing batch');
    const newStatus =
      batch.failed > 0
        ? PublicCompletionBatchRequestStatus.FAILED
        : PublicCompletionBatchRequestStatus.COMPLETED;
    await Promise.all([
      await this.completionBatchService.update(
        workspaceId,
        environmentId,
        batchId,
        {
          status: newStatus,
          errorMessage:
            newStatus === PublicCompletionBatchRequestStatus.FAILED
              ? 'Batch failed'
              : undefined,
          completedAt: new Date(),
        }
      ),
      this.queueService.updateBatchStatus(batch, newStatus),
      this.queueService.deleteBatchFromActiveResources(
        workspaceId,
        environmentId,
        batchId
      ),
    ]);
    this.logger.info({ batch }, 'Batch completed');

    if (
      batch.type === PublicCompletionBatchRequestType.CALLBACK &&
      this.completionBatchService.matchCallbackEvent(
        CompletionBatchCallbackEvent.BATCH_UPDATE,
        batch.callbackOptions
      )
    ) {
      this.logger.info({ batch }, 'Callback batch completed');
      const batchDetails = await this.completionBatchService.getById({
        workspaceId,
        environmentId,
        batchId,
        includesUsers: false,
        includesItems: false,
      });
      this.sendCallback(batchDetails, {
        event: 'BATCH_UPDATE',
        payload: batchDetails,
      });
    }
  }

  protected override async finishItem(
    item: QueueItem<CompletionBatchItemEntity>
  ): Promise<void> {
    await super.finishItem(item);
    const batch = await this.queueService.getBatch(
      item.payload.workspaceId,
      item.payload.environmentId,
      item.payload.batchId
    );

    if (
      batch.type === PublicCompletionBatchRequestType.CALLBACK &&
      this.completionBatchService.matchCallbackEvent(
        CompletionBatchCallbackEvent.ITEM_UPDATE,
        batch.callbackOptions
      )
    ) {
      this.logger.info({ item }, 'Callback item completed');
      this.sendCallback(batch, {
        event: 'ITEM_UPDATE',
        payload: item.payload,
      });
    }

    this.completionBatchService.incrementCounters(
      item.payload.workspaceId,
      item.payload.environmentId,
      item.payload.batchId,
      {
        completed:
          item.payload.status === PublicCompletionBatchRequestStatus.COMPLETED
            ? 1
            : 0,
        failed:
          item.payload.status === PublicCompletionBatchRequestStatus.FAILED
            ? 1
            : 0,
        running: -1,
      }
    );
  }

  private async sendCallback(
    batchDetails: CompletionBatchDto,
    payload: unknown
  ) {
    if (!batchDetails.callbackOptions?.url) {
      this.logger.warn({ batchDetails }, 'Callback URL not found');
      return;
    }

    const axiosInstance = axios.create();
    axiosRetry(axiosInstance, {
      retries: 5,
      retryDelay: axiosRetry.exponentialDelay,
    });

    try {
      const response = await axiosInstance.post(
        batchDetails.callbackOptions?.url,
        payload,
        {
          headers: {
            ...(batchDetails.callbackOptions?.headers ?? {}),
            'Content-Type': 'application/json',
          },
        }
      );

      this.logger.info({ response }, 'Callback batch completed');
    } catch (error) {
      this.logger.error({ error }, 'Callback batch failed');
    }
  }
}
