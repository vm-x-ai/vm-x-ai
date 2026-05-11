'use client';

import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import BarChartIcon from '@mui/icons-material/BarChart';
import ShowChartIcon from '@mui/icons-material/ShowChart';
import type { DatumValue } from '@nivo/core';
import type { LineSvgProps, LineSeries } from '@nivo/line';
import type { ScaleValue } from '@nivo/scales';
import { bytesToHumanReadable } from '@/utils/file';
import { formatCurrency } from '@/utils/number';
import { formatDuration, toUtc } from '@/utils/time';
import dynamic from 'next/dynamic';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { parseAsJson, useQueryState } from 'nuqs';
import React, { useMemo, useCallback, useState, useEffect } from 'react';
import { MetricDefinition, MetricFormat } from './types';

type ValueFormatter<Value extends ScaleValue> = (
  value: Value
) => Value | string;

type NivoMetricFormat = {
  yFormat?: string | ValueFormatter<string>;
  axisLeftLegend?: string;
  axisLeftFormat: string | ValueFormatter<number>;
};

const LineChart = dynamic(() => import('@/components/Usage/Charts/Line/Line'), {
  ssr: false,
});

const BarChart = dynamic(() => import('@/components/Usage/Charts/Bar/Bar'), {
  ssr: false,
});

const ContainerChart = dynamic(
  () => import('@/components/Usage/Charts/Container'),
  {
    ssr: false,
  }
);

type ChartType = 'line' | 'bar';

export type NamespaceGraphProps = {
  data: LineSvgProps<LineSeries>;
  metrics: MetricDefinition[];
  agg: Record<string, string>;
  xLegend: string;
  yLegend: string;
  autoRefresh?: boolean;
  autoRefreshInterval?: number;
  autoRefreshAction?: () => Promise<LineSvgProps<LineSeries> | undefined>;
  /**
   * Stable identifier used to namespace this chart's group-by override
   * inside the page-level `chartGroupBy` URL state. Required when
   * `metadataKeys` is provided so the override picker is rendered.
   */
  chartId?: string;
  /** Distinct metadata keys observed on recent audit rows; populates the
   *  per-chart override Autocomplete options. */
  metadataKeys?: string[];
  /** The group-by keys actually applied to the current chart query.
   *  Drives the override Autocomplete's selected value so the user can
   *  see what's currently in effect (override > page-wide default).
   *  Mixed list of fully-qualified strings: bare `RequestDimensions`
   *  enum values (`provider`, `connectionId`) plus `metadata.<key>`
   *  entries. */
  effectiveGroupBy?: string[];
  /** Base dimensions this chart can group by (e.g. `provider`,
   *  `connectionId`). Surfaced in the override picker alongside
   *  metadata keys so users can swap roll-up dimension per chart. */
  baseDimensionOptions?: string[];
};

export function NamespaceGraph({
  data: rawData,
  metrics,
  agg,
  xLegend,
  yLegend,
  autoRefresh,
  autoRefreshInterval,
  autoRefreshAction,
  chartId,
  metadataKeys = [],
  effectiveGroupBy = [],
  baseDimensionOptions = [],
}: NamespaceGraphProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [data, setData] = useState<LineSvgProps<LineSeries>>(rawData);
  const [loading, setLoading] = useState<boolean>(false);
  // Per-chart type toggle. Defaults to line; not persisted (the user can
  // re-flip per page load — keeps the URL state lean).
  const [chartType, setChartType] = useState<ChartType>('line');

  // Per-chart group-by override URL state. Shape: `{ "<chartId>": ["k1", ...] }`.
  // Reading and writing happens in this client component so the picker
  // rerenders inline; the server-side page reads the same param to
  // resolve `effectiveGroupBy` for the next fetch.
  const [chartGroupBy, setChartGroupBy] = useQueryState(
    'chartGroupBy',
    parseAsJson<Record<string, string[]>>((value) => {
      if (typeof value === 'string') {
        try {
          return JSON.parse(value);
        } catch {
          return {};
        }
      }
      return value;
    })
      .withDefault({})
      .withOptions({
        history: 'push',
        shallow: false,
      })
  );

  const setOverride = useCallback(
    (next: string[]) => {
      if (!chartId) return;
      const map = { ...(chartGroupBy ?? {}) };
      if (next.length === 0) {
        delete map[chartId];
      } else {
        map[chartId] = next;
      }
      setChartGroupBy(Object.keys(map).length === 0 ? {} : map);
    },
    [chartGroupBy, chartId, setChartGroupBy]
  );

  // Build the picker option list: chart's base dimensions first, then
  // metadata keys qualified as `metadata.<key>`. The two namespaces
  // never collide (RequestDimensions enum values don't start with
  // `metadata.`), so a single Autocomplete can render both.
  const groupByOptions = useMemo(
    () => [
      ...baseDimensionOptions,
      ...metadataKeys.map((k) => `metadata.${k}`),
    ],
    [baseDimensionOptions, metadataKeys]
  );
  // Override picker renders when there's a stable id and at least one
  // groupable option to pick from — otherwise the control would have
  // nothing to drive.
  const showOverridePicker = !!chartId && groupByOptions.length > 0;
  // Surface what's actually applied right now (server already resolved
  // override-vs-default), not the URL override alone.
  const overrideValue = effectiveGroupBy;

  useEffect(() => {
    setData(rawData);
  }, [rawData]);

  useEffect(() => {
    if (autoRefresh && autoRefreshInterval && autoRefreshAction) {
      const interval = setInterval(async () => {
        if (loading) {
          return;
        }

        setLoading(true);
        try {
          const newData = await autoRefreshAction();
          if (newData) {
            setData(newData);
          }
        } finally {
          setLoading(false);
        }
      }, autoRefreshInterval);

      return () => {
        clearInterval(interval);
      };
    }

    return () => {
      // do nothing
    };
  }, [autoRefresh, autoRefreshInterval, autoRefreshAction, loading]);

  const getMetricFormat = useCallback(() => {
    const config: NivoMetricFormat = {
      yFormat: undefined,
      axisLeftLegend: undefined,
      axisLeftFormat: '.2s',
    };

    if (metrics) {
      const metricsMap = metrics.reduce((acc, metric) => {
        acc[metric.name] = metric;
        return acc;
      }, {} as Record<string, MetricDefinition>);

      const formats = Object.keys(agg)
        .map<MetricDefinition>((metric) => metricsMap[metric])
        .filter((metric) => !!metric)
        .map((metric) => metric.format || MetricFormat.NUMBER);

      if (formats.length === 1 && formats[0] === MetricFormat.BYTES) {
        config.axisLeftFormat = bytesToHumanReadable;
        config.yFormat = (value: DatumValue): string => {
          if (typeof value === 'number') {
            return bytesToHumanReadable(value);
          }
          return value as string;
        };
        config.axisLeftLegend = 'bytes';
      } else if (
        formats.length === 1 &&
        formats[0] === MetricFormat.MILLISECONDS
      ) {
        config.axisLeftFormat = (value: number): string => {
          if (value < 1000) {
            return `${value}ms`;
          } else if (value < 60000) {
            return `${value / 1000}s`;
          } else if (value < 3600000) {
            return `${Math.floor(value / 60000)}m`;
          } else {
            return `${Math.floor(value / 3600000)}h`;
          }
        };
        config.yFormat = (value: DatumValue): string => {
          if (typeof value === 'number') {
            return formatDuration(value);
          }
          return value as string;
        };
      } else if (formats.length === 1 && formats[0] === MetricFormat.CURRENCY) {
        config.axisLeftFormat = formatCurrency;
        config.yFormat = (value: DatumValue): string =>
          typeof value === 'number' ? formatCurrency(value) : (value as string);
        config.axisLeftLegend = 'cost (USD)';
      }
    }

    return config;
  }, [agg, metrics]);

  const lineProps = useMemo<LineSvgProps<LineSeries> | null>(() => {
    if (!data) {
      return null;
    }

    const formatOptions = getMetricFormat();

    const config: LineSvgProps<LineSeries> = {
      ...data,
      axisBottom: {
        ...(data.axisBottom || {}),
        legend: xLegend,
      },
      axisLeft: {
        ...((data && data.axisLeft) || {}),
        legend: formatOptions.axisLeftLegend || yLegend,
        format: formatOptions.axisLeftFormat,
      },
      yFormat: formatOptions.yFormat as LineSvgProps<LineSeries>['yFormat'],
    };

    return config;
  }, [getMetricFormat, data, xLegend, yLegend]);

  return (
    <Grid container>
      <Grid size={12}>
        {/* Per-chart toolbar: group-by override on the left, line/bar
            toggle on the right. Both sit flush above the chart so users
            can change roll-up dimension or representation without
            leaving the chart card. The override picker is only shown
            when the parent provides a chartId + the metadata-keys list
            — otherwise there's nothing the user can pick. */}
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 1,
            mb: 0.5,
          }}
        >
          {showOverridePicker ? (
            <Autocomplete
              multiple
              disablePortal
              size="small"
              sx={{ width: '24rem' }}
              options={groupByOptions}
              value={overrideValue}
              onChange={(_, newValue) => setOverride(newValue)}
              disableCloseOnSelect
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Group by (override)"
                  placeholder={
                    overrideValue.length === 0 ? 'Page default' : undefined
                  }
                />
              )}
            />
          ) : (
            <Box />
          )}
          <ToggleButtonGroup
            size="small"
            exclusive
            value={chartType}
            onChange={(_, next: ChartType | null) => {
              if (next) setChartType(next);
            }}
            aria-label="Chart type"
          >
            <ToggleButton value="line" aria-label="line chart">
              <ShowChartIcon fontSize="small" />
            </ToggleButton>
            <ToggleButton value="bar" aria-label="bar chart">
              <BarChartIcon fontSize="small" />
            </ToggleButton>
          </ToggleButtonGroup>
        </Box>
        <ContainerChart>
          <Box
            sx={{
              height: '35vh',
              width: '100%',
            }}
          >
            {chartType === 'line' ? (
              <LineChart
                {...lineProps}
                data={(lineProps?.data || []) as LineSeries[]}
                onRangeSelected={(start, end) => {
                  const params = new URLSearchParams(searchParams?.toString());
                  params.set('start', toUtc(start).toISOString());
                  params.set('end', toUtc(end).toISOString());
                  params.set('dateType', 'absolute');
                  router.push(pathname + '?' + params.toString());
                }}
              />
            ) : (
              <BarChart
                data={(lineProps?.data || []) as LineSeries[]}
                axisBottom={lineProps?.axisBottom}
                axisLeft={lineProps?.axisLeft}
                yFormat={
                  lineProps?.yFormat as React.ComponentProps<
                    typeof BarChart
                  >['yFormat']
                }
              />
            )}
          </Box>
        </ContainerChart>
      </Grid>
    </Grid>
  );
}
