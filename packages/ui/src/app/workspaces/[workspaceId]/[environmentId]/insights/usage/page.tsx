import Grid from '@mui/material/Grid';
import type { DateRangePickerValue } from '@/components/DateRangePicker/types';
import UsageHeader from '@/components/Usage/Header';
import { LLMUsage } from '@/components/Usage/LLMUsage';
import { endOfMonth, startOfMonth } from 'date-fns';
import {
  parseAsStringEnum,
  parseAsString,
  parseAsIsoDateTime,
  parseAsInteger,
  createLoader,
  SearchParams,
  parseAsJson,
} from 'nuqs/server';
import React from 'react';
import {
  getApiKeys,
  getRequestAuditMetadataKeys,
  GranularityUnit,
} from '@/clients/api';

export type PageProps = {
  params: Promise<{
    workspaceId: string;
    environmentId: string;
  }>;
  searchParams?: Promise<SearchParams>;
};

const granularityParser = parseAsStringEnum(
  Object.values(GranularityUnit)
).withDefault(GranularityUnit.MINUTE);

const dateTypeParser = parseAsStringEnum(['relative', 'absolute']).withDefault(
  'relative'
);
const relativeUnitParser = parseAsString.withDefault('minute');
const autoRefreshParser = parseAsInteger.withDefault(0);
const relativeValueParser = parseAsInteger.withDefault(30);
const filtersParser = parseAsJson<Record<string, string[]>>((value) => {
  if (typeof value === 'string') {
    return JSON.parse(value);
  }
  return value;
}).withDefault({});

const metadataGroupByParser = parseAsJson<string[]>((value) => {
  if (typeof value === 'string') {
    return JSON.parse(value);
  }
  return value;
}).withDefault([]);

// Per-chart group-by override. Shape: { "<chartId>": ["tenantId", ...] }.
// When a chart's array is non-empty it overrides the page-wide
// `metadataGroupBy` for that chart only — lets users pin different
// dimensions per visualisation without losing the page-wide default.
const chartGroupByParser = parseAsJson<Record<string, string[]>>((value) => {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value;
}).withDefault({});

export default async function Page({ params, searchParams }: PageProps) {
  const { workspaceId, environmentId } = await params;
  const queryParams = await searchParams;
  const startDateParser = parseAsIsoDateTime.withDefault(
    startOfMonth(new Date())
  );
  const endDateParser = parseAsIsoDateTime.withDefault(endOfMonth(new Date()));

  const loadSearchParams = createLoader({
    granularity: granularityParser,
    dateType: dateTypeParser,
    relativeUnit: relativeUnitParser,
    relativeValue: relativeValueParser,
    start: startDateParser,
    end: endDateParser,
    filters: filtersParser,
    metadataGroupBy: metadataGroupByParser,
    chartGroupBy: chartGroupByParser,
  });

  const loadQueryParams = await loadSearchParams(queryParams ?? {});

  const [apiKeysResult, metadataKeysResult] = await Promise.all([
    getApiKeys({
      path: {
        workspaceId,
        environmentId,
      },
    }),
    getRequestAuditMetadataKeys({
      path: {
        workspaceId,
        environmentId,
      },
    }),
  ]);

  const { response, ...apiKeys } = apiKeysResult;
  const metadataKeys = metadataKeysResult.data ?? [];

  const granularity = loadQueryParams.granularity as GranularityUnit;
  const datePickerValue = {
    type: loadQueryParams.dateType,
    relative: {
      unit: loadQueryParams.relativeUnit,
      value: loadQueryParams.relativeValue,
    },
    absolute: {
      startDate: loadQueryParams.start,
      endDate: loadQueryParams.end,
    },
  } as DateRangePickerValue;

  const filters = loadQueryParams.filters ?? {};
  if (filters.apiKeyLabels) {
    if (apiKeys.data) {
      filters.apiKeyId = [
        ...(filters.apiKeyId || []),
        ...filters.apiKeyLabels.flatMap((label) =>
          apiKeys.data
            .filter((apiKey) => apiKey.labels?.includes(label))
            .map((apiKey) => apiKey.apiKeyId)
        ),
      ];
    }

    delete filters.apiKeyLabels;
  }

  const autoRefreshInterval = autoRefreshParser.parseServerSide(
    queryParams?.autoRefresh
  );
  const autoRefresh = autoRefreshInterval > 0;

  return (
    <Grid container spacing={3}>
      <Grid size={12}>
        <UsageHeader
          workspaceId={workspaceId}
          environmentId={environmentId}
          apiKeys={apiKeys}
          metadataKeys={metadataKeys}
        />
      </Grid>
      <Grid size={12}>
        <LLMUsage
          workspaceId={workspaceId}
          environmentId={environmentId}
          datePickerValue={datePickerValue}
          granularity={granularity}
          autoRefresh={autoRefresh}
          autoRefreshInterval={autoRefreshInterval}
          filters={filters}
          metadataGroupBy={loadQueryParams.metadataGroupBy ?? []}
          chartGroupBy={loadQueryParams.chartGroupBy ?? {}}
          metadataKeys={metadataKeys}
          searchParams={queryParams}
        />
      </Grid>
    </Grid>
  );
}
