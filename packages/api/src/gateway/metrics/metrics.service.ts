import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { addMinutes, format, subMinutes } from 'date-fns';
import { RedisClient } from '../../cache/redis-client';
import { MetricDto } from './dto/metric.dto';
import { CompletionPayloadMetricDto } from './dto/payload.dto';
import { PinoLogger } from 'nestjs-pino';

type BufferItem = {
  payload: CompletionPayloadMetricDto;
  attempts?: number;
};

@Injectable()
export class CompletionMetricsService {
  private buffer: BufferItem[] = [];
  private flushing = false;

  constructor(
    private readonly logger: PinoLogger,
    private readonly redisClient: RedisClient
  ) {}

  public push(payload: CompletionPayloadMetricDto) {
    this.buffer.push({ payload });
  }

  public async getErrorRate(
    workspaceId: string,
    environmentId: string,
    resource: string,
    aiConnectionId?: string,
    model?: string,
    window = 10, // 10 minutes
    statusCode: 'any' | number = 'any',
    timestamp = new Date()
  ): Promise<MetricDto> {
    const startTime = performance.now();
    this.logger.info(
      `Getting error rate for ${workspaceId}:${environmentId}:${resource} from ${timestamp.toISOString()} with window ${window} and status code ${statusCode}`
    );
    let totalSuccess = 0;
    let totalFailed = 0;

    let current = subMinutes(timestamp, window);
    const keys: string[] = [];
    while (current.getTime() <= timestamp.getTime()) {
      const key = `${this.getKeyPrefix(
        workspaceId,
        environmentId,
        resource,
        aiConnectionId,
        model
      )}:${format(current, 'yyyy-MM-dd-HH-mm')}`;
      const successKey = `${key}:requests:success`;
      const failedKey = `${key}:requests:failed:${statusCode}`;

      keys.push(successKey, failedKey);

      current = addMinutes(current, 1);
    }

    const results = await this.redisClient.client.mget(...keys);
    for (let i = 0; i < results.length; i += 2) {
      // 2 results per bucket (success and failed)
      const success = results[i];
      const failed = results[i + 1];

      totalSuccess += success ? parseInt(success, 10) : 0;
      totalFailed += failed ? parseInt(failed, 10) : 0;
    }

    const totalRequests = totalSuccess + totalFailed;
    const endTime = performance.now();
    this.logger.info(
      {
        totalSuccess,
        totalFailed,
        totalRequests,
      },
      `Time taken to get error rate: ${(endTime - startTime).toFixed(
        4
      )}ms for ${workspaceId}:${environmentId}:${resource}`
    );

    if (totalRequests === 0) {
      return { errorRate: 0, totalSuccess, totalFailed, totalRequests };
    }

    return {
      errorRate: (totalFailed / totalRequests) * 100,
      totalSuccess,
      totalFailed,
      totalRequests,
    };
  }

  @Cron(CronExpression.EVERY_SECOND, { name: 'completion-metrics-flush' })
  public async flush() {
    if (this.flushing || this.buffer.length === 0) {
      return;
    }

    this.flushing = true;
    // Save the buffer length before we start flushing
    const bufferLength = this.buffer.length;

    const groupedBuffer = this.buffer.reduce((acc, { payload }, index) => {
      const minuteBucket = format(payload.timestamp, 'yyyy-MM-dd-HH-mm');
      const key = `${this.getKeyPrefix(
        payload.workspaceId,
        payload.environmentId,
        payload.resourceId,
        payload.connectionId,
        payload.model
      )}:${minuteBucket}`;
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push({ payload, index });
      return acc;
    }, {} as Record<string, (BufferItem & { index: number })[]>);

    const flushed = await Promise.allSettled(
      Object.entries(groupedBuffer).map(async ([keyPrefix, payloads]) => {
        const success = payloads.filter(
          ({ payload }) => payload.statusCode < 300
        ).length;
        const failed = payloads.filter(
          ({ payload }) => payload.statusCode >= 400
        ).length;
        const retention = 60 * 60 * 3; // 3 hours

        const pipeline = this.redisClient.client.multi();

        if (success > 0) {
          pipeline
            .incrby(`${keyPrefix}:requests:success`, success)
            .expire(`${keyPrefix}:requests:success`, retention);
        }

        if (failed > 0) {
          pipeline
            .incrby(`${keyPrefix}:requests:failed:any`, failed)
            .expire(`${keyPrefix}:requests:failed:any`, retention);

          const failedStatusCodes = payloads.reduce((acc, { payload }) => {
            if (payload.statusCode >= 400) {
              acc[payload.statusCode] = (acc[payload.statusCode] || 0) + 1;
            }
            return acc;
          }, {} as Record<number, number>);

          for (const [statusCode, count] of Object.entries(failedStatusCodes)) {
            pipeline
              .incrby(`${keyPrefix}:requests:failed:${statusCode}`, count)
              .expire(`${keyPrefix}:requests:failed:${statusCode}`, retention);
          }
        }

        await pipeline.exec();
        return {
          start: payloads[0].index,
          end: payloads[payloads.length - 1].index,
        };
      })
    );

    // TODO: move this logic to a centralized place (usage.service also uses this logic)
    const failed: BufferItem[] = [];
    for (let i = 0; i < flushed.length; i++) {
      const flushedItem = flushed[i];
      if (flushedItem.status === 'rejected') {
        const bufferItem = this.buffer[i];
        if (bufferItem.attempts && bufferItem.attempts >= 3) {
          this.logger.error(
            `Failed to flush metrics for payload: ${JSON.stringify(
              bufferItem
            )} with error: ${flushedItem.reason}`
          );
          continue;
        }

        failed.push({
          ...this.buffer[i],
          attempts: (this.buffer[i].attempts || 0) + 1,
        });
        this.logger.error(
          `Failed to flush metrics for payload: ${JSON.stringify(
            this.buffer[i]
          )} with error: ${flushedItem.reason}`
        );
      }
    }
    this.logger.info(
      `Flushed ${bufferLength - failed.length} events, ${failed.length} failed`
    );

    this.buffer.splice(0, bufferLength);
    this.buffer.push(...failed);

    this.flushing = false;
  }

  private getKeyPrefix(
    workspaceId: string,
    environmentId: string,
    resourceId: string,
    aiConnectionId?: string,
    model?: string
  ) {
    return `{metrics:${workspaceId}:${environmentId}:${resourceId}:${
      aiConnectionId || 'none'
    }:${model || 'none'}}`;
  }
}
