import { Injectable } from '@nestjs/common';
import axios from 'axios';
import axiosRetry from 'axios-retry';
import { QueueItem } from './types/QueueItemMetadata';
import { CompletionBatchQueueBaseConsumer } from './batch-queue.base-consumer';
import { CompletionBatchQueueService } from './batch-queue.service';
import { CompletionBatchService } from './batch-service';
import { PinoLogger } from 'nestjs-pino';
import { CompletionBatchItemService } from './batch-item-service';
import { GatewayOrchestratorService } from '../gateway-orchestrator.service';
import { CompletionBatchItemEntity } from './entity/batch-item.entity';
import {
  PublicCompletionBatchRequestStatus,
  PublicCompletionBatchRequestType,
} from '../../storage/entities.generated';
import { CompletionBatchCallbackEvent } from './dto/callback-options.dto';
import { CompletionBatchDto } from './dto/batch.dto';
import { chatCompletionsToResponsesRequest } from '../responses/from-chat-completions';
import type { CanonicalRequestDto } from '../dto/completion-request.dto';
import { extractUsageFromResponse } from '../../ai-provider/response-shape.helpers';
import { isAsyncIterable } from '../../utils/async';

@Injectable()
export class CompletionBatchQueueConsumer extends CompletionBatchQueueBaseConsumer {
  constructor(
    logger: PinoLogger,
    queueService: CompletionBatchQueueService,
    completionBatchItemService: CompletionBatchItemService,
    private readonly completionService: GatewayOrchestratorService,
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

    // Batch items are stored in Chat Completions wire shape (the
    // public batch API surface). Normalize to canonical Responses for
    // the orchestrator and thread the original CC body through
    // `originalGatewayRequest` so dispatch keeps emitting Chat
    // Completions on the wire.
    const ccBody = {
      ...item.payload.request,
      model: item.payload.resourceId,
      stream: false as const,
      vmx: { correlationId: item.payload.batchId },
    };
    const canonical = chatCompletionsToResponsesRequest(
      ccBody
    ) as CanonicalRequestDto;
    const completionResponse = await this.completionService.completion(
      item.payload.workspaceId,
      item.payload.environmentId,
      canonical,
      item.context.apiKey,
      undefined,
      item.context.batch,
      undefined,
      undefined,
      ccBody,
      { format: 'chat-completions', body: ccBody }
    );

    // The provider response can be Chat Completions / Responses /
    // Anthropic shape — `extractUsageFromResponse` normalises across
    // the three. Non-streaming dispatch only here; the helper returns
    // CompletionUsage (Chat Completions wire-shape `usage` object).
    const responseUsage = !isAsyncIterable(completionResponse.data)
      ? extractUsageFromResponse(completionResponse.data)
      : undefined;

    item.payload = await this.completionBatchItemService.update(
      item.payload.workspaceId,
      item.payload.environmentId,
      item.payload.batchId,
      item.payload.itemId,
      {
        status: PublicCompletionBatchRequestStatus.COMPLETED,
        response: completionResponse,
        completedAt: new Date(),
        outputTokens: responseUsage?.completion_tokens ?? 0,
        promptTokens: responseUsage?.prompt_tokens ?? 0,
        totalTokens: responseUsage?.total_tokens ?? 0,
      }
    );

    if (responseUsage) {
      await this.completionBatchService.incrementCounters(
        item.payload.workspaceId,
        item.payload.environmentId,
        item.payload.batchId,
        {
          totalOutputTokens: responseUsage.completion_tokens,
          totalPromptTokens: responseUsage.prompt_tokens,
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
