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
import { getApiKeys, GranularityUnit } from '@/clients/api';

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
  });

  const loadQueryParams = await loadSearchParams(queryParams ?? {});

  const { response, ...apiKeys } = await getApiKeys({
    path: {
      workspaceId,
      environmentId,
    },
  });

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
        <UsageHeader apiKeys={apiKeys} />
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
          searchParams={queryParams}
        />
      </Grid>
    </Grid>
  );
}
