import 'reflect-metadata';

import { Injectable } from '@nestjs/common';
import { RequestUsageProvider } from '../usage.types';
import { DatabaseService } from '../../storage/database.service';
import { RequestUsageDto } from '../dto/request-usage.dto';
import {
  RequestDimensions,
  CompletionMetrics,
  RequestUsageDimensionOperator,
  RequestUsageQueryDto,
  GranularityUnit,
} from '../dto/request-query.dto';
import { sql } from 'kysely';
import { RequestUsageQueryRawResultDto } from '../dto/request-query-result.dto';

const OPERATOR_MAP = {
  [RequestUsageDimensionOperator.EQ]: '=',
  [RequestUsageDimensionOperator.NEQ]: '!=',
  [RequestUsageDimensionOperator.IN]: 'in',
  [RequestUsageDimensionOperator.NIN]: 'not in',
  [RequestUsageDimensionOperator.GT]: '>',
  [RequestUsageDimensionOperator.GTE]: '>=',
  [RequestUsageDimensionOperator.LT]: '<',
  [RequestUsageDimensionOperator.LTE]: '<=',
  [RequestUsageDimensionOperator.IS_NOT]: 'is not',
} as const;

/**
 * Maps logical metric names (CompletionMetrics) to the underlying SQL
 * expression in the request_audit table. Most are simple column
 * references; requestCount/errorCount/successCount are derived.
 */
const METRIC_EXPRESSIONS: Record<string, ReturnType<typeof sql>> = {
  [CompletionMetrics.PROMPT_TOKENS]: sql.ref('prompt_tokens'),
  [CompletionMetrics.OUTPUT_TOKENS]: sql.ref('output_tokens'),
  [CompletionMetrics.TOTAL_TOKENS]: sql.ref('total_tokens'),
  [CompletionMetrics.CACHED_TOKENS]: sql.ref('cached_tokens'),
  [CompletionMetrics.REASONING_TOKENS]: sql.ref('reasoning_tokens'),
  [CompletionMetrics.TOKENS_PER_SECOND]: sql.ref('tokens_per_second'),
  [CompletionMetrics.TIME_TO_FIRST_TOKEN]: sql.ref('time_to_first_token'),
  [CompletionMetrics.REQUEST_COUNT]: sql`1`,
  [CompletionMetrics.ERROR_COUNT]: sql.ref('error_count'),
  [CompletionMetrics.SUCCESS_COUNT]: sql.ref('success_count'),
  [CompletionMetrics.REQUEST_DURATION]: sql.ref('request_duration'),
  [CompletionMetrics.PROVIDER_DURATION]: sql.ref('provider_duration'),
  [CompletionMetrics.GATE_DURATION]: sql.ref('gate_duration'),
  [CompletionMetrics.ROUTING_DURATION]: sql.ref('routing_duration'),
  // Cost metrics extracted from the `cost` JSONB column
  [CompletionMetrics.TOTAL_COST]: sql`(cost->>'totalCost')::double precision`,
  [CompletionMetrics.INPUT_COST]: sql`(cost->>'inputCost')::double precision`,
  [CompletionMetrics.OUTPUT_COST]: sql`(cost->>'outputCost')::double precision`,
  [CompletionMetrics.CACHED_COST]: sql`(cost->>'cachedCost')::double precision`,
  [CompletionMetrics.REASONING_COST]: sql`(cost->>'reasoningCost')::double precision`,
};

const DIMENSION_COLUMN_MAP: Record<string, string> = {
  [RequestDimensions.WORKSPACE_ID]: 'workspace_id',
  [RequestDimensions.ENVIRONMENT_ID]: 'environment_id',
  [RequestDimensions.CONNECTION_ID]: 'connection_id',
  [RequestDimensions.RESOURCE_ID]: 'resource_id',
  [RequestDimensions.PROVIDER]: 'provider',
  [RequestDimensions.MODEL]: 'model',
  [RequestDimensions.REQUEST_ID]: 'request_id',
  [RequestDimensions.MESSAGE_ID]: 'message_id',
  [RequestDimensions.FAILURE_REASON]: 'failure_reason',
  [RequestDimensions.STATUS_CODE]: 'status_code',
  [RequestDimensions.CORRELATION_ID]: 'correlation_id',
  [RequestDimensions.API_KEY_ID]: 'api_key_id',
  [RequestDimensions.SOURCE_IP]: 'source_ip',
  [RequestDimensions.USER_ID]: 'user_id',
};

/**
 * Resolve a dimension/filter field name to a SQL expression.
 *
 * - Standard RequestDimensions values map to `request_audit` columns.
 * - Dynamic `metadata.<key>` dimensions are extracted via JSONB
 *   (`metadata->>'<key>'`). The result column is aliased back to
 *   `metadata.<key>` so the API consumer sees the same shape they sent.
 *
 * Returning a Kysely sql template means callers can use the same expression
 * in SELECT, GROUP BY, ORDER BY, and WHERE without re-parsing.
 */
function resolveDimensionExpression(field: string): ReturnType<typeof sql> {
  const standardColumn = DIMENSION_COLUMN_MAP[field];
  if (standardColumn) {
    return sql.ref(standardColumn);
  }
  if (field.startsWith('metadata.')) {
    const key = field.slice('metadata.'.length);
    return sql<string>`metadata->>${sql.lit(key)}`;
  }
  // Fallback: treat as a raw column reference (for legacy callers).
  return sql.ref(field);
}

@Injectable()
export class PostgresRequestUsageProvider implements RequestUsageProvider {
  constructor(private readonly db: DatabaseService) {}

  async query(
    query: RequestUsageQueryDto
  ): Promise<RequestUsageQueryRawResultDto[]> {
    let dbQuery = this.db.reader.selectFrom('requestAudit');

    if (query.limit) {
      dbQuery = dbQuery.limit(query.limit);
    }

    let timeExpression = sql`timestamp`;
    if (query.granularity) {
      switch (query.granularity) {
        case GranularityUnit.SECOND:
        case GranularityUnit.SECOND_5:
        case GranularityUnit.SECOND_10:
        case GranularityUnit.SECOND_15:
        case GranularityUnit.SECOND_30: {
          const secondInterval = parseInt(query.granularity.split('_')[1]) || 1;
          timeExpression = sql`to_timestamp(floor(extract(epoch from timestamp) / ${sql.lit(
            secondInterval
          )}) * ${sql.lit(secondInterval)})`;
          break;
        }
        case GranularityUnit.MINUTE:
          timeExpression = sql`date_trunc('minute', timestamp)`;
          break;
        case GranularityUnit.HOUR:
          timeExpression = sql`date_trunc('hour', timestamp)`;
          break;
        case GranularityUnit.DAY:
          timeExpression = sql`date_trunc('day', timestamp)`;
          break;
        case GranularityUnit.WEEK:
          timeExpression = sql`date_trunc('week', timestamp)`;
          break;
        case GranularityUnit.MONTH:
          timeExpression = sql`date_trunc('month', timestamp)`;
          break;
        case GranularityUnit.YEAR:
          timeExpression = sql`date_trunc('year', timestamp)`;
          break;
      }
      dbQuery = dbQuery.select([timeExpression.as('time')]);
    }

    // Combine standard dimensions + dynamic metadata dimensions. The
    // metadata ones come in already prefixed (`metadata.<key>`) and are
    // resolved to JSONB extracts by resolveDimensionExpression.
    const allDimensions: string[] = [
      ...query.dimensions,
      ...(query.metadataDimensions ?? []),
    ];
    for (const dimension of allDimensions) {
      const expr = resolveDimensionExpression(dimension);
      dbQuery = dbQuery.select(expr.as(dimension));
    }

    for (const [metric, agg] of Object.entries(query.agg)) {
      const expr = METRIC_EXPRESSIONS[metric] ?? sql.ref(metric);
      const approxPercentileMatch = /p(\d+)/g.exec(agg);

      if (approxPercentileMatch) {
        const percentile = parseInt(approxPercentileMatch[1]) / 100;
        dbQuery = dbQuery.select(
          sql<number>`percentile_cont(${sql.lit(
            percentile
          )}) within group (order by ${expr})`.as(metric)
        );
      } else {
        dbQuery = dbQuery.select(
          sql<number>`cast(${sql.raw(agg)}(${expr}) as double precision)`.as(
            metric
          )
        );
      }
    }

    for (const [dimension, orderBy] of Object.entries(query.orderBy ?? {})) {
      dbQuery = dbQuery.orderBy(sql.ref(dimension), orderBy);
    }

    dbQuery = dbQuery
      .where('timestamp', '>=', new Date(query.filter.dateRange.start))
      .where('timestamp', '<', new Date(query.filter.dateRange.end));

    for (const [field, filter] of Object.entries(query.filter.fields ?? {})) {
      if (
        [
          RequestUsageDimensionOperator.IN,
          RequestUsageDimensionOperator.NIN,
        ].includes(filter.operator) &&
        (!filter.value ||
          !Array.isArray(filter.value) ||
          filter.value.length === 0)
      ) {
        continue;
      }

      dbQuery = dbQuery.where(
        resolveDimensionExpression(field),
        OPERATOR_MAP[filter.operator],
        filter.value
      );
    }

    const groupByExpressions: ReturnType<typeof sql>[] = allDimensions.map(
      (d) => resolveDimensionExpression(d)
    );

    if (query.granularity) {
      dbQuery = dbQuery.groupBy([timeExpression, ...groupByExpressions]);
    } else if (groupByExpressions.length > 0) {
      dbQuery = dbQuery.groupBy(groupByExpressions);
    }

    const rows = (await dbQuery.execute()) as Array<Record<string, unknown>>;

    return rows.map((row) => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) {
        out[k] = v instanceof Date ? v.toISOString() : v;
      }
      return out as unknown as RequestUsageQueryRawResultDto;
    });
  }

  /**
   * `push` is a no-op because the postgres provider reads usage data
   * directly from the request_audit table. Audit writes happen via
   * RequestAuditService and are the single source of truth.
   */
  async push(..._usage: RequestUsageDto[]): Promise<void> {
    // intentionally empty
  }
}
