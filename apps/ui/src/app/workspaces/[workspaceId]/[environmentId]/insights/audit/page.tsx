import Alert from '@mui/material/Alert';
import Grid from '@mui/material/Grid';
import AuditTable from '@/components/Audit/Table';
import type {
  DateRangePickerValue,
  RelativeValueUnit,
} from '@/components/DateRangePicker/types';
import { parseDateRangePickerValue } from '@/components/DateRangePicker/utils';
import { mapProviders } from '@/utils/provider';
import {
  parseAsString,
  parseAsIsoDateTime,
  parseAsInteger,
  createLoader,
  SearchParams,
} from 'nuqs/server';
import {
  getAiConnections,
  getAiProviders,
  getAiResources,
  getApiKeys,
  getCompletionAudit,
} from '@/clients/api';

export type PageProps = {
  params: Promise<{
    workspaceId: string;
    environmentId: string;
  }>;
  searchParams: Promise<SearchParams>;
};

const dateTypeParser = parseAsString.withDefault('relative');
const relativeUnitParser = parseAsString.withDefault('day');
const relativeValueParser = parseAsInteger.withDefault(7);
const pageSizeParser = parseAsInteger.withDefault(100);
const pageIndexParser = parseAsInteger.withDefault(0);

const loadSearchParams = createLoader({
  pageIndex: pageIndexParser,
  pageSize: pageSizeParser,
  dateType: dateTypeParser,
  relativeUnit: relativeUnitParser,
  relativeValue: relativeValueParser,
  start: parseAsIsoDateTime,
  end: parseAsIsoDateTime,
  resourceId: parseAsString,
  connectionId: parseAsString,
  statusCode: parseAsInteger,
});

export default async function Page({ params, searchParams }: PageProps) {
  const { workspaceId, environmentId } = await params;
  const loadQueryParams = await loadSearchParams(searchParams);

  const datePickerValue = {
    type: loadQueryParams.dateType as 'relative' | 'absolute',
    relative: {
      unit: loadQueryParams.relativeUnit as RelativeValueUnit,
      value: loadQueryParams.relativeValue,
    },
    absolute: {
      startDate: loadQueryParams.start,
      endDate: loadQueryParams.end,
    },
  } as DateRangePickerValue;

  const { start, end } = parseDateRangePickerValue(
    datePickerValue,
    (date) => date?.toISOString() ?? new Date().toISOString()
  );

  const [auditData, providers, resources, connections, apiKeys] =
    await Promise.all([
      getCompletionAudit({
        path: {
          workspaceId,
          environmentId,
        },
        query: {
          connectionId: loadQueryParams.connectionId,
          resourceId: loadQueryParams.resourceId,
          statusCode: loadQueryParams.statusCode,
          startDate: start,
          endDate: end,
          pageIndex: loadQueryParams.pageIndex,
          pageSize: loadQueryParams.pageSize,
        },
      }),
      getAiProviders(),
      getAiResources({
        path: {
          workspaceId,
          environmentId,
        },
      }),
      getAiConnections({
        path: {
          workspaceId,
          environmentId,
        },
      }),
      getApiKeys({
        path: {
          workspaceId,
          environmentId,
        },
      }),
    ]);

  if (auditData.error) {
    return (
      <Alert variant="filled" severity="error">
        Failed to load audit data {auditData.error.errorMessage}
      </Alert>
    );
  }

  const providersMap = providers.data
    ? mapProviders(providers.data)
    : undefined;

  return (
    <Grid container spacing={3}>
      <Grid size={12}>
        <AuditTable
          workspaceId={workspaceId}
          environmentId={environmentId}
          data={auditData.data}
          providersMap={providersMap}
          resourcesMap={
            resources.data
              ? resources.data.reduce(
                  (acc, item) => ({ ...acc, [item.resourceId]: item }),
                  {}
                )
              : undefined
          }
          aiConnectionMap={
            connections.data
              ? connections.data.reduce(
                  (acc, item) => ({ ...acc, [item.connectionId]: item }),
                  {}
                )
              : undefined
          }
          apiKeysMap={
            apiKeys.data
              ? apiKeys.data.reduce(
                  (acc, item) => ({ ...acc, [item.apiKeyId]: item }),
                  {}
                )
              : undefined
          }
        />
      </Grid>
    </Grid>
  );
}
