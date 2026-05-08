import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import Typography from '@mui/material/Typography';
import React, { Suspense } from 'react';
import type { DateRangePickerValue } from '../../DateRangePicker/types';
import { LLMCostGraph } from './CostGraph';
import { DefaultLoading } from './DefaultLoading';
import { LLMRequestFailureReasonGraph } from './RequestFailureReasonGraph';
import { LLMRequestGraph } from './RequestGraph';
import { LLMRequestLatencyGraph } from './RequestLatencyGraph';
import { LLMTokenGraph } from './TokenGraph';
import { TopTables } from './TopTables';
import { TopByCostBar } from './TopByCostBar';
import { ErrorsByStatusCodeGraph } from './ErrorsByStatusCodeGraph';
import { LatencyPercentilesGraph } from './LatencyPercentilesGraph';
import { PlaceholderCard } from './PlaceholderCard';
import { UsageTotalsBar, UsageTotalsBarLoading } from './TotalsBar';
import { GranularityUnit, RequestDimensions } from '@/clients/api';

export type LLMUsageProps = {
  workspaceId: string;
  environmentId: string;
  granularity: GranularityUnit;
  filters: Record<string, string[]>;
  datePickerValue: DateRangePickerValue;
  autoRefresh: boolean;
  autoRefreshInterval?: number;
  /**
   * List of metadata keys (without the `metadata.` prefix) selected in the
   * "Group By Metadata" header control. Charts append `metadata.<key>` to
   * their `dimensions` query field so usage rolls up by tenant_id, project, etc.
   */
  metadataGroupBy?: string[];
  /**
   * Per-chart override map: `chartId → fully-qualified group-by list`.
   * Each entry is a mix of bare `RequestDimensions` enum values
   * (`provider`, `connectionId`) and `metadata.<key>` strings. When
   * non-empty, replaces the chart's defaults (base dimensions +
   * page-level metadataGroupBy). Lets users pin a different roll-up
   * dimension per visualisation.
   */
  chartGroupBy?: Record<string, string[]>;
  /** Distinct metadata keys observed in the last 30 days — drives the
   *  per-chart override Autocomplete options. */
  metadataKeys?: string[];
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
  metadataGroupBy = [],
  chartGroupBy = {},
  metadataKeys = [],
  searchParams,
}: LLMUsageProps) {
  // Per-chart override slice — each chart resolves its own effective
  // dimension list (override OR baseDimensions + page metadataGroupBy)
  // from this slice plus the page-wide selection it already receives.
  const overrideFor = (chartId: string): string[] | undefined =>
    chartGroupBy[chartId];
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
      {/* Top-of-page big-number summary — total cost + token breakdown
          for the active window/filters. Streams independently of the
          charts below so it lands fast on the initial paint. */}
      <Grid size={12}>
        <Suspense key={suspenseKey} fallback={<UsageTotalsBarLoading />}>
          <UsageTotalsBar
            workspaceId={workspaceId}
            environmentId={environmentId}
            filters={filters}
            datePickerValue={datePickerValue}
          />
        </Suspense>
      </Grid>
      <Grid size={12}>
        <Typography variant="h6">Cost</Typography>
        <Divider />
        <Typography variant="caption">
          USD cost over the selected window, derived from the model_pricing
          table at the time each request was served. Rows whose model is not in
          the pricing table show $0 — add an entry under Settings → Pricing.
        </Typography>
      </Grid>
      <Grid size={12}>
        <Suspense key={suspenseKey} fallback={<DefaultLoading />}>
          <LLMCostGraph
            datePickerValue={datePickerValue}
            environmentId={environmentId}
            workspaceId={workspaceId}
            granularity={granularity}
            filters={filters}
            metadataGroupBy={metadataGroupBy}
            dimensionsOverride={overrideFor('cost')}
            chartId="cost"
            metadataKeys={metadataKeys}
            autoRefresh={autoRefresh}
            autoRefreshInterval={autoRefreshInterval}
          />
        </Suspense>
      </Grid>
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
                metadataGroupBy={metadataGroupBy}
                dimensionsOverride={overrideFor('token')}
                chartId="token"
                metadataKeys={metadataKeys}
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
                metadataGroupBy={metadataGroupBy}
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
                metadataGroupBy={metadataGroupBy}
                dimensionsOverride={overrideFor('request')}
                chartId="request"
                metadataKeys={metadataKeys}
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
                metadataGroupBy={metadataGroupBy}
                dimensionsOverride={overrideFor('requestFailure')}
                chartId="requestFailure"
                metadataKeys={metadataKeys}
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
                metadataGroupBy={metadataGroupBy}
                dimensionsOverride={overrideFor('requestLatency')}
                chartId="requestLatency"
                metadataKeys={metadataKeys}
                autoRefresh={autoRefresh}
                autoRefreshInterval={autoRefreshInterval}
              />
            </Suspense>
          </Grid>
          <Grid size={12}>
            <Suspense key={suspenseKey} fallback={<DefaultLoading />}>
              <LatencyPercentilesGraph
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
        <Typography variant="h6">Errors</Typography>
        <Divider />
        <Typography variant="caption">
          Error counts over the selected window, broken down first by HTTP
          status code, then by VM-X failure reason. Use these to spot 429 spikes
          and pin down which provider/route was responsible.
        </Typography>
      </Grid>
      <Grid size={12}>
        <Grid container spacing={3}>
          <Grid size={6}>
            <Suspense key={suspenseKey} fallback={<DefaultLoading />}>
              <ErrorsByStatusCodeGraph
                datePickerValue={datePickerValue}
                environmentId={environmentId}
                workspaceId={workspaceId}
                granularity={granularity}
                filters={filters}
                metadataGroupBy={metadataGroupBy}
                dimensionsOverride={overrideFor('errorsByStatus')}
                chartId="errorsByStatus"
                metadataKeys={metadataKeys}
                autoRefresh={autoRefresh}
                autoRefreshInterval={autoRefreshInterval}
              />
            </Suspense>
          </Grid>
          <Grid size={6}>
            <Suspense key={suspenseKey} fallback={<DefaultLoading />}>
              <ErrorsByStatusCodeGraph
                datePickerValue={datePickerValue}
                environmentId={environmentId}
                workspaceId={workspaceId}
                granularity={granularity}
                filters={filters}
                metadataGroupBy={metadataGroupBy}
                dimensionsOverride={overrideFor('errorsByFailure')}
                chartId="errorsByFailure"
                metadataKeys={metadataKeys}
                autoRefresh={autoRefresh}
                autoRefreshInterval={autoRefreshInterval}
                byFailureReason
              />
            </Suspense>
          </Grid>
        </Grid>
      </Grid>
      <Grid size={12}>
        <Typography variant="h6">Spend breakdown</Typography>
        <Divider />
        <Typography variant="caption">
          Top spenders by API key and by correlation id. Cost-by-metadata is
          implicitly available through the `Group By Metadata` selector at the
          top of this page — every chart respects the selected metadata
          dimensions.
        </Typography>
      </Grid>
      <Grid size={12}>
        <Grid container spacing={3}>
          <Grid size={6}>
            <Suspense key={suspenseKey} fallback={<DefaultLoading />}>
              <TopByCostBar
                datePickerValue={datePickerValue}
                environmentId={environmentId}
                workspaceId={workspaceId}
                filters={filters}
                dimension={RequestDimensions.API_KEY_ID}
                title="Top API keys by cost"
                caption="Sum of totalCost grouped by apiKeyId, descending."
              />
            </Suspense>
          </Grid>
          <Grid size={6}>
            <Suspense key={suspenseKey} fallback={<DefaultLoading />}>
              <TopByCostBar
                datePickerValue={datePickerValue}
                environmentId={environmentId}
                workspaceId={workspaceId}
                filters={filters}
                dimension={RequestDimensions.CORRELATION_ID}
                title="Top correlation IDs by cost"
                caption="Surfaces expensive multi-step agent runs that share a vmx.correlationId."
              />
            </Suspense>
          </Grid>
        </Grid>
      </Grid>
      <Grid size={12}>
        <Typography variant="h6">Reliability + savings (preview)</Typography>
        <Divider />
        <Typography variant="caption">
          Charts that need additional event/state plumbing. Tracked here so the
          Usage page reserves space for them; data lights up as the backend
          wiring lands.
        </Typography>
      </Grid>
      <Grid size={12}>
        <Grid container spacing={3}>
          <Grid size={6}>
            <PlaceholderCard
              title="Fallback trigger frequency"
              description="Count of requests that cascaded from the primary model to a fallback model. Tells you which connections are unreliable, broken down by primary→fallback pair."
              needs={[
                "New `fallback_count` metric (or use the existing `events` JSON column on `request_audit` to count rows where events.type === 'fallback')",
                'New chart query that groups by failedModel + routedModel',
              ]}
            />
          </Grid>
          <Grid size={6}>
            <PlaceholderCard
              title="Routing decision distribution"
              description="When dynamic routing is enabled, which routing condition matched most often. Validates whether the rules you wrote reflect real traffic."
              needs={[
                'Reads `events.type === "routing"` rows from request_audit',
                'New chart query grouping by `routing.matchedConditionId`',
              ]}
            />
          </Grid>
          <Grid size={6}>
            <PlaceholderCard
              title="Cache hit rate"
              description="% of tokens served from a provider cache (OpenAI / Anthropic prompt caching). Once a cache layer is wired in, this becomes cachedTokens / promptTokens over time."
              needs={[
                'cachedTokens metric is already collected — but the chart needs the rate (cached / prompt) as a derived series',
                'A simple ratio component on top of the existing TokenGraph data',
              ]}
            />
          </Grid>
          <Grid size={6}>
            <PlaceholderCard
              title="Cost-savings vs naive baseline"
              description="Cumulative delta between what each routed/fallen-back request actually cost and what it would have cost on the resource's primary model. Headline metric for VM-X ROI."
              needs={[
                "Server-side compute: for each row, look up the primary model's pricing and recompute hypothetical cost",
                'New `costSavingsCumulative` metric or a server-rendered card on the Usage page',
              ]}
            />
          </Grid>
          <Grid size={12}>
            <PlaceholderCard
              title="Concurrency over time"
              description="Sliding-window count of in-flight requests. Useful for capacity planning — surfaces when your peak concurrency hits the resource's RPM/TPM limits."
              needs={[
                'New aggregation: count rows where startedAt <= bucket <= endedAt',
                'Either materialised view or window function on `request_audit`',
              ]}
            />
          </Grid>
        </Grid>
      </Grid>
    </Grid>
  );
}
