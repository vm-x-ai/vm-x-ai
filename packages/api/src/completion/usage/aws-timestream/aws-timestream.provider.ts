import 'reflect-metadata';

import { Injectable } from '@nestjs/common';
import { CompletionUsageProvider } from '../usage.types';
import { AWSTimestreamDatabaseService } from './storage/database.service';
import { CompletionUsageDto } from '../dto/completion-usage.dto';
import {
  CompletionUsageDimensionOperator,
  CompletionUsageQueryDto,
  GranularityUnit,
} from '../dto/completion-query.dto';
import { sql } from 'kysely';
import { CompletionUsageQueryRawResultDto } from '../dto/completion-query-result.dto';
import { ConfigService } from '@nestjs/config';
import {
  _Record,
  Dimension,
  MeasureValue,
  TimestreamWriteClient,
  WriteRecordsCommand,
} from '@aws-sdk/client-timestream-write';
import { toZonedTime } from 'date-fns-tz';
import { ValidationException } from '@aws-sdk/client-timestream-query';

const OPERATOR_MAP = {
  [CompletionUsageDimensionOperator.EQ]: '=',
  [CompletionUsageDimensionOperator.NEQ]: '!=',
  [CompletionUsageDimensionOperator.IN]: 'in',
  [CompletionUsageDimensionOperator.NIN]: 'not in',
  [CompletionUsageDimensionOperator.GT]: '>',
  [CompletionUsageDimensionOperator.GTE]: '>=',
  [CompletionUsageDimensionOperator.LT]: '<',
  [CompletionUsageDimensionOperator.LTE]: '<=',
  [CompletionUsageDimensionOperator.IS_NOT]: 'is not',
} as const;

@Injectable()
export class QuestDBCompletionUsageProvider implements CompletionUsageProvider {
  constructor(
    private readonly db: AWSTimestreamDatabaseService,
    private readonly configService: ConfigService
  ) {}

  async query(
    query: CompletionUsageQueryDto
  ): Promise<CompletionUsageQueryRawResultDto[]> {
    let dbQuery = this.db.instance.selectFrom('completions');
    if (query.limit) {
      dbQuery = dbQuery.limit(query.limit);
    }

    let timeExpression = sql`time`;
    if (query.granularity) {
      switch (query.granularity) {
        case GranularityUnit.SECOND:
        case GranularityUnit.SECOND_5:
        case GranularityUnit.SECOND_10:
        case GranularityUnit.SECOND_15:
        case GranularityUnit.SECOND_30: {
          const secondInterval = parseInt(query.granularity.split('_')[1]) || 1;
          timeExpression = sql`bin(time, ${sql.lit(secondInterval)}s)`;
          break;
        }
        case GranularityUnit.MINUTE:
          timeExpression = sql`date_trunc('minute', time)`;
          break;
        case GranularityUnit.HOUR:
          timeExpression = sql`date_trunc('hour', time)`;
          break;
        case GranularityUnit.DAY:
          timeExpression = sql`date_trunc('day', time)`;
          break;
        case GranularityUnit.WEEK:
          timeExpression = sql`date_trunc('week', time)`;
          break;
        case GranularityUnit.MONTH:
          timeExpression = sql`date_trunc('month', time)`;
          break;
        case GranularityUnit.YEAR:
          timeExpression = sql`date_trunc('year', time)`;
          break;
      }
      dbQuery = dbQuery.select([
        timeExpression.as('time'),
        ...query.dimensions,
      ]);
    } else {
      dbQuery = dbQuery.select([...query.dimensions]);
    }

    for (const [metric, agg] of Object.entries(query.agg)) {
      const approxPercentileMatch = /p(\d+)/g.exec(agg);

      if (approxPercentileMatch) {
        const percentile = parseInt(approxPercentileMatch[1]) / 100;
        dbQuery = dbQuery.select(
          sql`approx_percentile(${sql.ref(metric)}, ${sql.lit(percentile)})`.as(
            metric
          )
        );
      } else {
        dbQuery = dbQuery.select(
          sql<number>`${sql.raw(agg)}(${sql.ref(metric)})`.as(metric)
        );
      }
    }

    for (const [dimension, orderBy] of Object.entries(query.orderBy ?? {})) {
      dbQuery = dbQuery.orderBy(sql.ref(dimension), orderBy);
    }

    dbQuery = dbQuery
      .where(
        'time',
        '>=',
        toZonedTime(new Date(query.filter.dateRange.start), 'UTC')
      )
      .where(
        'time',
        '<',
        toZonedTime(new Date(query.filter.dateRange.end), 'UTC')
      );

    for (const [field, filter] of Object.entries(query.filter.fields ?? {})) {
      if (
        [
          CompletionUsageDimensionOperator.IN,
          CompletionUsageDimensionOperator.NIN,
        ].includes(filter.operator) &&
        (!filter.value ||
          !Array.isArray(filter.value) ||
          filter.value.length === 0)
      ) {
        continue;
      }

      dbQuery = dbQuery.where(
        sql.ref(field),
        OPERATOR_MAP[filter.operator],
        filter.value
      );
    }

    dbQuery = dbQuery.groupBy(
      query.granularity
        ? [timeExpression, ...query.dimensions]
        : [...query.dimensions]
    );
    try {
      return (await dbQuery.execute()) as CompletionUsageQueryRawResultDto[];
    } catch (error) {
      if (error instanceof ValidationException) {
        if (error.message?.includes('does not exist')) {
          return [];
        }
      }

      throw error;
    }
  }

  async push(...usage: CompletionUsageDto[]): Promise<void> {
    const databaseName = this.configService.getOrThrow<string>(
      'AWS_TIMESTREAM_DATABASE_NAME'
    );
    const writeClient = new TimestreamWriteClient({});
    await writeClient.send(
      new WriteRecordsCommand({
        DatabaseName: databaseName,
        TableName: 'completions',
        Records: usage.map(this.parseUsageRow),
      })
    );
  }

  private parseUsageRow(item: CompletionUsageDto): _Record {
    const metricsValues: MeasureValue[] = [
      {
        Name: 'requestCount',
        Value: '1',
        Type: 'BIGINT',
      },
      {
        Name: 'errorCount',
        Value: item.error ? '1' : '0',
        Type: 'BIGINT',
      },
      {
        Name: 'successCount',
        Value: item.error ? '0' : '1',
        Type: 'BIGINT',
      },
    ];

    const metrics = [
      ['promptTokens', 'BIGINT'],
      ['completionTokens', 'BIGINT'],
      ['totalTokens', 'BIGINT'],
      ['tokensPerSecond', 'DOUBLE'],
      ['timeToFirstToken', 'BIGINT'],
      ['requestDuration', 'BIGINT'],
      ['providerDuration', 'BIGINT'],
      ['gateDuration', 'BIGINT'],
      ['routingDuration', 'BIGINT'],
    ] as const;

    metrics.forEach(([metric, type]) => {
      if (item[metric]) {
        metricsValues.push({
          Name: metric,
          Value: item[metric].toString(),
          Type: type,
        });
      }
    });

    const dimensionsValues: Dimension[] = [];
    const dimensions = [
      'workspaceId',
      'environmentId',
      'connectionId',
      'resourceId',
      'provider',
      'model',
      'requestId',
      'messageId',
      'failureReason',
      'statusCode',
      'correlationId',
      'apiKeyId',
      'sourceIp',
      'userId',
    ] as const;

    dimensions.forEach((dimension) => {
      if (item[dimension]) {
        dimensionsValues.push({
          Name: dimension,
          Value: item[dimension].toString(),
        });
      }
    });

    return {
      TimeUnit: 'MILLISECONDS',
      Time: item.timestamp.getTime().toString(),
      MeasureName: 'completion',
      MeasureValueType: 'MULTI',
      MeasureValues: metricsValues,
      Dimensions: dimensionsValues,
    };
  }
}
