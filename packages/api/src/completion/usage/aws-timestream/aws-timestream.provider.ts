import 'reflect-metadata';

import { Injectable } from '@nestjs/common';
import { CompletionUsageProvider } from '../usage.types';
import { AWSTimestreamDatabaseService } from './storage/database.service';
import { CompletionUsageDto } from '../dto/completion-usage.dto';
import { plainToInstance } from 'class-transformer';
import { replaceUndefinedWithNull } from '../../../utils/object';
import {
  CompletionUsageDimensionOperator,
  CompletionUsageQueryDto,
  GranularityUnit,
} from '../dto/completion-query.dto';
import { sql } from 'kysely';
import { CompletionUsageQueryRawResultDto } from '../dto/completion-query-result.dto';

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
  constructor(private readonly db: AWSTimestreamDatabaseService) {}

  async query(
    query: CompletionUsageQueryDto
  ): Promise<CompletionUsageQueryRawResultDto[]> {
    let dbQuery = this.db.instance.selectFrom('completions');
    if (query.limit) {
      dbQuery = dbQuery.limit(query.limit);
    }

    let timeExpression = sql`ts as time`;
    if (query.granularity) {
      switch (query.granularity) {
        case GranularityUnit.SECOND:
        case GranularityUnit.SECOND_5:
        case GranularityUnit.SECOND_10:
        case GranularityUnit.SECOND_15:
        case GranularityUnit.SECOND_30: {
          const secondInterval = parseInt(query.granularity.split('_')[1]) || 1;
          timeExpression = sql`timestamp_floor('${sql.lit(
            secondInterval
          )}s', ts)`;
          break;
        }
        case GranularityUnit.MINUTE:
          timeExpression = sql`date_trunc('minute', ts)`;
          break;
        case GranularityUnit.HOUR:
          timeExpression = sql`date_trunc('hour', ts)`;
          break;
        case GranularityUnit.DAY:
          timeExpression = sql`date_trunc('day', ts)`;
          break;
        case GranularityUnit.WEEK:
          timeExpression = sql`date_trunc('week', ts)`;
          break;
        case GranularityUnit.MONTH:
          timeExpression = sql`date_trunc('month', ts)`;
          break;
        case GranularityUnit.YEAR:
          timeExpression = sql`date_trunc('year', ts)`;
          break;
      }
      dbQuery = dbQuery.select([
        sql`cast(${timeExpression} as string)`.as('time'),
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
          sql<number>`cast(${sql.raw(agg)}(${sql.ref(metric)}) as double)`.as(
            metric
          )
        );
      }
    }

    for (const [dimension, orderBy] of Object.entries(query.orderBy ?? {})) {
      dbQuery = dbQuery.orderBy(sql.ref(dimension), orderBy);
    }

    dbQuery = dbQuery
      .where('ts', '>=', new Date(query.filter.dateRange.start))
      .where('ts', '<', new Date(query.filter.dateRange.end));

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
    return (await dbQuery.execute()) as CompletionUsageQueryRawResultDto[];
  }

  async push(...usage: CompletionUsageDto[]): Promise<void> {
    const values = usage.map((item) => {
      const value = plainToInstance(
        CompletionUsageDto,
        replaceUndefinedWithNull(item)
      );
      const { timestamp, error, ...rest } = value;
      return {
        ...rest,
        ts: item.timestamp,
        requestCount: 1,
        errorCount: item.error ? 1 : 0,
        successCount: item.error ? 0 : 1,
      };
    });
    await this.db.instance.insertInto('completions').values(values).execute();
  }
}
