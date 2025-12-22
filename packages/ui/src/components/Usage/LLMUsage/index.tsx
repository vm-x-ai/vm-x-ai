import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import Typography from '@mui/material/Typography';
import React, { Suspense } from 'react';
import type { DateRangePickerValue } from '../../DateRangePicker/types';
import { DefaultLoading } from './DefaultLoading';
import { LLMRequestFailureReasonGraph } from './RequestFailureReasonGraph';
import { LLMRequestGraph } from './RequestGraph';
import { LLMRequestLatencyGraph } from './RequestLatencyGraph';
import { LLMTokenGraph } from './TokenGraph';
import { TopTables } from './TopTables';
import { GranularityUnit } from '@/clients/api';

export type LLMUsageProps = {
  workspaceId: string;
  environmentId: string;
  granularity: GranularityUnit;
  filters: Record<string, string[]>;
  datePickerValue: DateRangePickerValue;
  autoRefresh: boolean;
  autoRefreshInterval?: number;
  searchParams?: Record<string, string | string[] | undefined>;
};

export async function LLMUsage({
  workspaceId,
  environmentId,
  granularity,
  filters,
  datePickerValue,
  autoRefresh,
  autoRefreshInterval,
  searchParams,
}: LLMUsageProps) {
  const suspenseKey = Object.keys(searchParams ?? {})
    .reduce((acc, key) => {
      const value = searchParams?.[key];
      if (value && Array.isArray(value)) {
        value.forEach((v) => acc.append(key, v));
      } else {
        acc.append(key, value ?? '');
      }

      return acc;
    }, new URLSearchParams())
    .toString();

  return (
    <Grid container spacing={3}>
      <Grid size={12}>
        <Typography variant="h6">Token Usage</Typography>
        <Divider />
        <Typography variant="caption">
          The following chart shows the total number of tokens used by the ai
          provider and model.
        </Typography>
      </Grid>
      <Grid size={12}>
        <Grid container spacing={3}>
          <Grid size={8}>
            <Suspense key={suspenseKey} fallback={<DefaultLoading />}>
              <LLMTokenGraph
                datePickerValue={datePickerValue}
                environmentId={environmentId}
                workspaceId={workspaceId}
                granularity={granularity}
                filters={filters}
                autoRefresh={autoRefresh}
                autoRefreshInterval={autoRefreshInterval}
              />
            </Suspense>
          </Grid>
          <Grid size={4}>
            <Suspense key={suspenseKey} fallback={<DefaultLoading />}>
              <TopTables
                datePickerValue={datePickerValue}
                environmentId={environmentId}
                workspaceId={workspaceId}
                filters={filters}
                autoRefresh={autoRefresh}
                autoRefreshInterval={autoRefreshInterval}
              />
            </Suspense>
          </Grid>
        </Grid>
      </Grid>
      <Grid size={12}>
        <Typography variant="h6">Request details</Typography>
        <Divider />
        <Typography variant="caption">
          The following chart show the total number of requests made to the
          resource grouped by success and error, and in the second chart the
          failure reasons.
        </Typography>
      </Grid>
      <Grid size={12}>
        <Grid container spacing={3}>
          <Grid size={6}>
            <Suspense key={suspenseKey} fallback={<DefaultLoading />}>
              <LLMRequestGraph
                datePickerValue={datePickerValue}
                environmentId={environmentId}
                workspaceId={workspaceId}
                granularity={granularity}
                filters={filters}
                autoRefresh={autoRefresh}
                autoRefreshInterval={autoRefreshInterval}
              />
            </Suspense>
          </Grid>
          <Grid size={6}>
            <Suspense key={suspenseKey} fallback={<DefaultLoading />}>
              <LLMRequestFailureReasonGraph
                datePickerValue={datePickerValue}
                environmentId={environmentId}
                workspaceId={workspaceId}
                granularity={granularity}
                filters={filters}
                autoRefresh={autoRefresh}
                autoRefreshInterval={autoRefreshInterval}
              />
            </Suspense>
          </Grid>
        </Grid>
      </Grid>
      <Grid size={12}>
        <Typography variant="h6">Request Latency</Typography>
        <Divider />
        <Typography variant="caption">
          The following chart shows the latency of the requests made to the
          resource.
        </Typography>
      </Grid>
      <Grid size={12}>
        <Grid container spacing={3}>
          <Grid size={12}>
            <Suspense key={suspenseKey} fallback={<DefaultLoading />}>
              <LLMRequestLatencyGraph
                datePickerValue={datePickerValue}
                environmentId={environmentId}
                workspaceId={workspaceId}
                granularity={granularity}
                filters={filters}
                autoRefresh={autoRefresh}
                autoRefreshInterval={autoRefreshInterval}
              />
            </Suspense>
          </Grid>
        </Grid>
      </Grid>
    </Grid>
  );
}
