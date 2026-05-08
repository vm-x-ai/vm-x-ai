import { Inject, Injectable } from '@nestjs/common';
import {
  REQUEST_USAGE_PROVIDER,
  type RequestUsageProvider,
} from './usage.types';
import { RequestUsageDto } from './dto/request-usage.dto';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PinoLogger } from 'nestjs-pino';
import {
  RequestDimensions,
  RequestUsageQueryDto,
  GranularityUnit,
} from './dto/request-query.dto';
import {
  RequestUsageDimensionValueDto,
  RequestUsageQueryRawResultDto,
  RequestUsageQueryResultDto,
} from './dto/request-query-result.dto';
import {
  endOfDay,
  endOfHour,
  endOfMinute,
  endOfSecond,
  format,
  startOfDay,
  startOfHour,
  startOfMinute,
  startOfSecond,
} from 'date-fns';
import { toZonedTime, formatInTimeZone } from 'date-fns-tz';
import assert from 'node:assert';
import { AIConnectionService } from '../ai-connection/ai-connection.service';
import { AIProviderService } from '../ai-provider/ai-provider.service';
import { ApiKeyService } from '../api-key/api-key.service';
import { EnvironmentService } from '../environment/environment.service';
import { WorkspaceService } from '../workspace/workspace.service';
import { AIResourceService } from '../ai-resource/ai-resource.service';
import { UsersService } from '../users/users.service';

type BufferItem = {
  payload: RequestUsageDto;
  attempts?: number;
};

interface GetByIdsService<T> {
  getByIds(ids: string[]): Promise<T[]>;
}

@Injectable()
export class RequestUsageService {
  private buffer: BufferItem[] = [];
  private flushing = false;

  constructor(
    private readonly logger: PinoLogger,
    @Inject(REQUEST_USAGE_PROVIDER)
    private readonly requestUsageProvider: RequestUsageProvider,
    private readonly workspaceService: WorkspaceService,
    private readonly environmentService: EnvironmentService,
    private readonly userService: UsersService,
    private readonly aiResourceService: AIResourceService,
    private readonly aiConnectionService: AIConnectionService,
    private readonly aiProviderService: AIProviderService,
    private readonly apiKeyService: ApiKeyService
  ) {}

  async query(
    query: RequestUsageQueryDto
  ): Promise<RequestUsageQueryResultDto[]> {
    const providerResults = await this.requestUsageProvider.query(query);
    let results: RequestUsageQueryRawResultDto[] = providerResults;
    if (query.granularity === GranularityUnit.DAY) {
      results = this.normalizeResultByDay(query, providerResults);
    } else if (query.granularity === GranularityUnit.WEEK) {
      results = this.normalizeResultByWeek(query, providerResults);
    } else if (query.granularity === GranularityUnit.MONTH) {
      results = this.normalizeResultByMonth(query, providerResults);
    } else if (query.granularity === GranularityUnit.YEAR) {
      results = this.normalizeResultByYear(query, providerResults);
    } else if (query.granularity === GranularityUnit.HOUR) {
      results = this.normalizeResultByHour(query, providerResults);
    } else if (query.granularity === GranularityUnit.MINUTE) {
      results = this.normalizeResultByMinute(query, providerResults);
    } else if (query.granularity?.startsWith('second')) {
      results = this.normalizeResultBySecond(query, providerResults);
    }

    const resolvers = await Promise.all([
      this.getDimensionValueResult(
        query,
        RequestDimensions.WORKSPACE_ID,
        providerResults,
        this.workspaceService,
        'workspaceId',
        'Workspace',
        (workspace) => workspace.name
      ),
      this.getDimensionValueResult(
        query,
        RequestDimensions.ENVIRONMENT_ID,
        providerResults,
        this.environmentService,
        'environmentId',
        'Environment',
        (environment) => environment.name
      ),
      this.getDimensionValueResult(
        query,
        RequestDimensions.CONNECTION_ID,
        providerResults,
        this.aiConnectionService,
        'connectionId',
        'Connection',
        (connection) => connection.name
      ),
      this.getDimensionValueResult(
        query,
        RequestDimensions.PROVIDER,
        providerResults,
        this.aiProviderService,
        (provider) => provider.provider.id,
        'Provider',
        (provider) => provider.provider.name
      ),
      this.getDimensionValueResult(
        query,
        RequestDimensions.API_KEY_ID,
        providerResults,
        this.apiKeyService,
        'apiKeyId',
        'API Key',
        (apiKey) => apiKey.apiKeyId
      ),
      this.getDimensionValueResult(
        query,
        RequestDimensions.RESOURCE_ID,
        providerResults,
        this.aiResourceService,
        'resourceId',
        'Resource',
        (resource) => resource.name
      ),
      this.getDimensionValueResult(
        query,
        RequestDimensions.USER_ID,
        providerResults,
        this.userService,
        'id',
        'User',
        (user) => user.name
      ),
    ]);

    const combineResolvers = (
      row: RequestUsageQueryRawResultDto
    ): RequestUsageQueryResultDto => {
      const values = resolvers
        .map((resolver) => resolver(row))
        .filter(Boolean)
        .reduce((acc, value) => {
          assert(value, 'Value is required');
          Object.entries(value).forEach(([key, value]) => {
            acc[key] = value;
          });
          return acc;
        }, {} as Record<string, RequestUsageDimensionValueDto | undefined>);

      return {
        ...row,
        ...values,
      } as RequestUsageQueryResultDto;
    };

    return results.map<RequestUsageQueryResultDto>(combineResolvers);
  }

  private async getDimensionValueResult<T>(
    query: RequestUsageQueryDto,
    dimension: RequestDimensions,
    result: RequestUsageQueryRawResultDto[],
    service: GetByIdsService<T>,
    idKey: keyof T | ((entity: T) => string),
    label: string,
    displayName: (entity: T) => string
  ): Promise<
    (
      row: RequestUsageQueryRawResultDto
    ) => Record<string, RequestUsageDimensionValueDto | undefined>
  > {
    const uniqValues = query.dimensions.includes(dimension)
      ? [
          ...new Set(
            result
              .map((result) => result[dimension])
              .filter(Boolean) as string[]
          ),
        ]
      : [];
    const values = await service.getByIds(uniqValues);
    const valuesMap = new Map<string, T>(
      values.map((item) => [
        typeof idKey === 'function' ? idKey(item) : (item[idKey] as string),
        item,
      ])
    );

    return function (row: RequestUsageQueryRawResultDto) {
      const entity = valuesMap.get(row[dimension] as string);
      return {
        [dimension]: row[dimension]
          ? ({
              value: row[dimension],
              label,
              displayName: entity
                ? displayName(entity)
                : `${row[dimension]} (Deleted)`,
            } as RequestUsageDimensionValueDto)
          : undefined,
      };
    };
  }

  private normalizeResultByDay(
    query: RequestUsageQueryDto,
    result: RequestUsageQueryRawResultDto[]
  ) {
    const normalizedResult: RequestUsageQueryRawResultDto[] = [];

    const dateMap = result.reduce((acc, row) => {
      const date = new Date(row.time);
      const key = formatInTimeZone(date, 'UTC', 'yyyy-MM-dd');
      if (!acc[key]) {
        acc[key] = [];
      }

      acc[key].push(row);
      return acc;
    }, {} as Record<string, RequestUsageQueryRawResultDto[]>);
    const startDate = startOfDay(
      toZonedTime(new Date(query.filter.dateRange.start), 'UTC')
    ).getTime();
    const endDate = endOfDay(
      toZonedTime(new Date(query.filter.dateRange.end), 'UTC')
    ).getTime();

    const currentDate = new Date(startDate);
    while (currentDate.getTime() < endDate) {
      const key = formatInTimeZone(currentDate, 'UTC', 'yyyy-MM-dd');
      if (dateMap[key]) {
        normalizedResult.push(
          ...dateMap[key].map((item) => ({
            ...item,
            time: key,
          }))
        );
      } else {
        const item: RequestUsageQueryRawResultDto = {
          time: key,
        };

        normalizedResult.push(item);
      }
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return normalizedResult;
  }

  private normalizeResultByWeek(
    query: RequestUsageQueryDto,
    result: RequestUsageQueryRawResultDto[]
  ) {
    const normalizedResult: RequestUsageQueryRawResultDto[] = [];
    const weekMap = result.reduce((acc, row) => {
      const date = new Date(row.time);
      const week = format(date, 'RRRR-ww');
      if (!acc[week]) {
        acc[week] = [];
      }
      acc[week].push(row);
      return acc;
    }, {} as Record<string, RequestUsageQueryRawResultDto[]>);

    const startWeek = parseInt(
      format(new Date(query.filter.dateRange.start), 'RRRRww')
    );
    const endWeek = parseInt(
      format(new Date(query.filter.dateRange.end), 'RRRRww')
    );

    let currentWeek = startWeek;
    while (currentWeek <= endWeek) {
      const weekStr = currentWeek.toString();
      const yearStr = weekStr.substring(0, weekStr.length - 2);
      const yearWeekStr = weekStr
        .substring(weekStr.length - 2)
        .padStart(2, '0');
      const week = `${yearStr}-${yearWeekStr}`;
      if (weekMap[week]) {
        normalizedResult.push(
          ...weekMap[week].map((item) => ({
            ...item,
            time: week,
          }))
        );
      } else {
        const item: RequestUsageQueryRawResultDto = {
          time: week,
        };

        normalizedResult.push(item);
      }

      if (yearWeekStr === '52') {
        currentWeek = parseInt(`${parseInt(yearStr) + 1}01`);
      } else {
        currentWeek++;
      }
    }

    return normalizedResult;
  }

  private normalizeResultByMonth(
    query: RequestUsageQueryDto,
    result: RequestUsageQueryRawResultDto[]
  ) {
    const normalizedResult: RequestUsageQueryRawResultDto[] = [];
    const monthMap = result.reduce((acc, row) => {
      const month = formatInTimeZone(row.time, 'UTC', 'yyyy-MM');
      if (!acc[month]) {
        acc[month] = [];
      }
      acc[month].push(row);
      return acc;
    }, {} as Record<string, RequestUsageQueryRawResultDto[]>);

    const startMonth = parseInt(
      formatInTimeZone(new Date(query.filter.dateRange.start), 'UTC', 'yyyyMM')
    );
    const endMonth = parseInt(
      formatInTimeZone(new Date(query.filter.dateRange.end), 'UTC', 'yyyyMM')
    );

    let currentMonth = startMonth;
    while (currentMonth <= endMonth) {
      const monthStr = currentMonth.toString();
      const yearStr = monthStr.substring(0, monthStr.length - 2);
      const yearMonthStr = monthStr
        .substring(monthStr.length - 2)
        .padStart(2, '0');

      const month = `${yearStr}-${yearMonthStr}`;
      if (monthMap[month]) {
        normalizedResult.push(
          ...monthMap[month].map((item) => ({
            ...item,
            time: month,
          }))
        );
      } else {
        const item: RequestUsageQueryRawResultDto = {
          time: month,
        };

        normalizedResult.push(item);
      }

      if (yearMonthStr === '12') {
        currentMonth = parseInt(`${parseInt(yearStr) + 1}01`);
      } else {
        currentMonth++;
      }
    }

    return normalizedResult;
  }

  private normalizeResultByYear(
    query: RequestUsageQueryDto,
    result: RequestUsageQueryRawResultDto[]
  ) {
    const normalizedResult: RequestUsageQueryRawResultDto[] = [];
    const yearMap = result.reduce((acc, row) => {
      const date = new Date(row.time);
      const year = date.getUTCFullYear();
      if (!acc[year]) {
        acc[year] = [];
      }
      acc[year].push(row);
      return acc;
    }, {} as Record<number, RequestUsageQueryRawResultDto[]>);

    const startYear = new Date(query.filter.dateRange.start).getUTCFullYear();
    const endYear = new Date(query.filter.dateRange.end).getUTCFullYear();

    let currentYear = startYear;
    while (currentYear <= endYear) {
      if (yearMap[currentYear]) {
        normalizedResult.push(
          ...yearMap[currentYear].map((item) => ({
            ...item,
            time: currentYear.toString(),
          }))
        );
      } else {
        const item: RequestUsageQueryRawResultDto = {
          time: currentYear.toString(),
        };

        normalizedResult.push(item);
      }
      currentYear++;
    }

    return normalizedResult;
  }

  private normalizeResultByHour(
    query: RequestUsageQueryDto,
    result: RequestUsageQueryRawResultDto[]
  ) {
    const normalizedResult: RequestUsageQueryRawResultDto[] = [];
    const dateMap = result.reduce((acc, row) => {
      const date = new Date(row.time).getTime();
      if (!acc[date]) {
        acc[date] = [];
      }

      acc[date].push(row);
      return acc;
    }, {} as Record<number, RequestUsageQueryRawResultDto[]>);

    const startDate = startOfHour(
      new Date(query.filter.dateRange.start)
    ).getTime();
    const endDate = endOfHour(new Date(query.filter.dateRange.end)).getTime();

    const currentDate = new Date(startDate);
    while (currentDate.getTime() < endDate) {
      const key = currentDate.getTime();
      const time = formatInTimeZone(
        currentDate,
        query.timeZone ?? 'UTC',
        'yyyy-MM-dd HH:mm:ss'
      );
      if (dateMap[key]) {
        normalizedResult.push(
          ...dateMap[key].map((item) => ({
            ...item,
            time,
          }))
        );
      } else {
        const item: RequestUsageQueryRawResultDto = {
          time,
        };

        normalizedResult.push(item);
      }
      currentDate.setHours(currentDate.getHours() + 1);
    }

    return normalizedResult;
  }

  private normalizeResultByMinute(
    query: RequestUsageQueryDto,
    result: RequestUsageQueryRawResultDto[]
  ) {
    const normalizedResult: RequestUsageQueryRawResultDto[] = [];
    const dateMap = result.reduce((acc, row) => {
      const date = new Date(row.time).getTime();
      if (!acc[date]) {
        acc[date] = [];
      }

      acc[date].push(row);
      return acc;
    }, {} as Record<number, RequestUsageQueryRawResultDto[]>);
    const startDate = startOfMinute(new Date(query.filter.dateRange.start));
    const endDate = endOfMinute(new Date(query.filter.dateRange.end)).getTime();

    const currentDate = new Date(startDate);
    while (currentDate.getTime() < endDate) {
      const key = currentDate.getTime();
      const time = formatInTimeZone(
        currentDate,
        query.timeZone ?? 'UTC',
        'yyyy-MM-dd HH:mm:ss'
      );
      if (dateMap[key]) {
        normalizedResult.push(
          ...dateMap[key].map((item) => ({
            ...item,
            time,
          }))
        );
      } else {
        const item: RequestUsageQueryRawResultDto = {
          time,
        };

        normalizedResult.push(item);
      }
      currentDate.setMinutes(currentDate.getMinutes() + 1);
    }

    return normalizedResult;
  }

  private normalizeResultBySecond(
    query: RequestUsageQueryDto,
    result: RequestUsageQueryRawResultDto[]
  ) {
    assert(query.granularity, 'Granularity is required');
    const secondInterval = query.granularity.startsWith('second_')
      ? parseInt(query.granularity.split('_')[1])
      : 1;

    const normalizedResult: RequestUsageQueryRawResultDto[] = [];
    const dateMap = result.reduce((acc, row) => {
      const date = new Date(row.time).getTime();

      if (!acc[date]) {
        acc[date] = [];
      }

      acc[date].push(row);
      return acc;
    }, {} as Record<number, RequestUsageQueryRawResultDto[]>);

    let startDate = startOfSecond(
      new Date(query.filter.dateRange.start)
    ).getTime();
    let endDate = endOfSecond(new Date(query.filter.dateRange.end)).getTime();

    if (secondInterval > 1) {
      startDate =
        startDate -
        secondInterval * 1000 -
        (startDate % (secondInterval * 1000));
      endDate =
        endDate + (secondInterval * 1000 - (endDate % (secondInterval * 1000)));
    }

    const currentDate = new Date(startDate);
    while (currentDate.getTime() < endDate) {
      const key = currentDate.getTime();
      const time = formatInTimeZone(
        currentDate,
        query.timeZone ?? 'UTC',
        'yyyy-MM-dd HH:mm:ss'
      );
      if (dateMap[key]) {
        normalizedResult.push(
          ...dateMap[key].map((item) => ({
            ...item,
            time,
          }))
        );
      } else {
        const item: RequestUsageQueryRawResultDto = {
          time,
        };

        normalizedResult.push(item);
      }
      currentDate.setSeconds(currentDate.getSeconds() + secondInterval);
    }

    return normalizedResult;
  }

  push(payload: RequestUsageDto): void {
    this.buffer.push({ payload });
    if (this.buffer.length >= 100) {
      this.flush();
    }
  }

  @Cron(CronExpression.EVERY_10_SECONDS, { name: 'request-usage-flush' })
  public async flush() {
    if (this.buffer.length === 0 || this.flushing) {
      return;
    }
    const bufferLength = this.buffer.length;
    const transit = [...this.buffer];
    this.flushing = true;
    try {
      await this.requestUsageProvider.push(
        ...transit.map(({ payload }) => payload)
      );

      this.logger.info(`Flushed ${transit.length} items`);
      this.buffer.splice(0, bufferLength);
    } catch (error) {
      this.logger.error(`Failed to flush completion usage: ${error}`);
      this.buffer.splice(0, bufferLength);
      const dropItems = transit.filter(
        (item) => item.attempts && item.attempts > 3
      );
      this.logger.error(`Dropped ${dropItems.length} items`);
      const retryItems = transit.filter(
        (item) => item.attempts && item.attempts <= 3
      );
      this.buffer.push(
        ...retryItems.map((item) => ({
          ...item,
          attempts: (item.attempts || 0) + 1,
        }))
      );
      this.logger.error(`Pushed ${retryItems.length} items back to buffer`);
      this.logger.error(`Buffer now has ${this.buffer.length} items`);
    } finally {
      this.flushing = false;
    }
  }
}
