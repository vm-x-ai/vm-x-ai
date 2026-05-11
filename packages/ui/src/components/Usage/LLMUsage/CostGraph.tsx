import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Alert from '@mui/material/Alert';
import React from 'react';
import type { DateRangePickerValue } from '../../DateRangePicker/types';
import { NamespaceGraph } from '../NamespaceGraph';
import { LLMCostSummaryTable } from './CostSummaryTable';
import {
  parseDateRangePickerValueToAPIFilter,
  resolveEffectiveDimensions,
  splitDimensions,
} from './utils';
import {
  RequestDimensions,
  RequestUsageDimensionFilterDto,
  RequestUsageDimensionOperator,
  RequestUsageQueryDto,
  getRequestUsage,
  GranularityUnit,
} from '@/clients/api';
import { MetricDefinition, MetricFormat } from '../types';
import { linePropsByTimeUnit, toNivoLineSerie } from '../utils/nivo';
import { LineSeries, LineSvgProps } from '@nivo/line';

export type LLMCostGraphProps = {
  workspaceId: string;
  environmentId: string;
  granularity: GranularityUnit;
  filters: Record<string, string[]>;
  datePickerValue: DateRangePickerValue;
  autoRefresh: boolean;
  autoRefreshInterval?: number;
  /** Page-wide metadata-group-by selections (bare keys, no prefix).
   *  Joined with this chart's base dimensions when no per-chart
   *  override is set. */
  metadataGroupBy?: string[];
  /** Per-chart group-by override (fully-qualified strings: bare
   *  `RequestDimensions` or `metadata.<key>`). When non-empty,
   *  replaces the chart's defaults entirely. */
  dimensionsOverride?: string[];
  /** Stable id for this chart's per-chart group-by override slot. */
  chartId?: string;
  /** All distinct metadata keys observed recently — drives the override
   *  picker's option list. */
  metadataKeys?: string[];
};

const baseDimensions = [RequestDimensions.PROVIDER, RequestDimensions.MODEL];

const metrics: MetricDefinition[] = [
  {
    name: 'totalCost',
    type: 'double',
    format: MetricFormat.CURRENCY,
  },
];

function getUsageBody(
  granularity: GranularityUnit,
  filters: Record<string, string[]>,
  datePickerValue: DateRangePickerValue,
  effectiveDimensions: string[]
): RequestUsageQueryDto {
  const { dimensions, metadataDimensions } =
    splitDimensions(effectiveDimensions);
  return {
    granularity,
    dimensions,
    metadataDimensions,
    agg: {
      totalCost: 'sum',
    },
    filter: {
      dateRange: parseDateRangePickerValueToAPIFilter(datePickerValue),
      fields: Object.entries(filters).reduce((acc, [key, value]) => {
        acc[key as RequestDimensions] = {
          operator: RequestUsageDimensionOperator.IN,
          value: value,
        };
        return acc;
      }, {} as Record<RequestDimensions, RequestUsageDimensionFilterDto>),
    },
    orderBy: {
      time: 'asc',
    },
  };
}

function getTableUsageBody(
  filters: Record<string, string[]>,
  datePickerValue: DateRangePickerValue,
  effectiveDimensions: string[]
): RequestUsageQueryDto {
  const { dimensions, metadataDimensions } =
    splitDimensions(effectiveDimensions);
  return {
    dimensions,
    metadataDimensions,
    // Break the cost down so the summary table can show users where the
    // money actually went (input vs output vs cached vs reasoning).
    agg: {
      inputCost: 'sum',
      outputCost: 'sum',
      cachedCost: 'sum',
      reasoningCost: 'sum',
      totalCost: 'sum',
    },
    filter: {
      dateRange: parseDateRangePickerValueToAPIFilter(datePickerValue),
      fields: Object.entries(filters).reduce((acc, [key, value]) => {
        acc[key as RequestDimensions] = {
          operator: RequestUsageDimensionOperator.IN,
          value: value,
        };
        return acc;
      }, {} as Record<RequestDimensions, RequestUsageDimensionFilterDto>),
    },
    orderBy: {
      provider: 'asc',
      model: 'asc',
    },
  };
}

export async function LLMCostGraph({
  workspaceId,
  environmentId,
  granularity,
  filters,
  datePickerValue,
  autoRefresh,
  autoRefreshInterval,
  metadataGroupBy = [],
  dimensionsOverride,
  chartId,
  metadataKeys = [],
}: LLMCostGraphProps) {
  const effectiveDimensions = resolveEffectiveDimensions(
    baseDimensions,
    metadataGroupBy,
    dimensionsOverride
  );
  const dimensions = effectiveDimensions;
  const aggregations: RequestUsageQueryDto['agg'] = {
    totalCost: 'sum',
  };

  const result = await getRequestUsage({
    path: { workspaceId, environmentId },
    body: getUsageBody(
      granularity,
      filters,
      datePickerValue,
      effectiveDimensions
    ),
  });

  if (result.error) {
    return (
      <Alert variant="filled" severity="error">
        Failed to load cost graph: {result.error.errorMessage}
      </Alert>
    );
  }

  const tableData = await getRequestUsage({
    path: { workspaceId, environmentId },
    body: getTableUsageBody(filters, datePickerValue, effectiveDimensions),
  });

  const nivoLine = {
    ...linePropsByTimeUnit(granularity),
    data: toNivoLineSerie(
      result.data,
      dimensions,
      metrics.map((metric) => metric.name),
      'time'
    ),
  } as LineSvgProps<LineSeries>;

  return (
    <>
      <Accordion
        defaultExpanded
        slotProps={{ transition: { unmountOnExit: true } }}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          Chart
        </AccordionSummary>
        <AccordionDetails>
          <NamespaceGraph
            data={nivoLine}
            metrics={metrics}
            agg={aggregations}
            xLegend="LLM Cost"
            yLegend="USD"
            chartId={chartId}
            metadataKeys={metadataKeys}
            baseDimensionOptions={baseDimensions}
            effectiveGroupBy={effectiveDimensions}
            autoRefresh={autoRefresh}
            autoRefreshInterval={autoRefreshInterval}
            autoRefreshAction={async () => {
              'use server';

              const result = await getRequestUsage({
                path: { workspaceId, environmentId },
                body: getUsageBody(
                  granularity,
                  filters,
                  datePickerValue,
                  effectiveDimensions
                ),
              });
              if (result.error) {
                return undefined;
              }

              return {
                ...linePropsByTimeUnit(granularity),
                data: toNivoLineSerie(
                  result.data,
                  dimensions,
                  metrics.map((metric) => metric.name),
                  'time'
                ),
              } as LineSvgProps<LineSeries>;
            }}
          />
        </AccordionDetails>
      </Accordion>
      <Accordion slotProps={{ transition: { unmountOnExit: true } }}>
        <AccordionSummary
          expandIcon={<ExpandMoreIcon />}
          aria-controls="cost-table-content"
          id="cost-table-header"
        >
          Summary Table
        </AccordionSummary>
        <AccordionDetails>
          {tableData.data && (
            <LLMCostSummaryTable
              data={tableData.data}
              autoRefresh={autoRefresh}
              autoRefreshInterval={autoRefreshInterval}
              autoRefreshAction={async () => {
                'use server';

                const result = await getRequestUsage({
                  path: { workspaceId, environmentId },
                  body: getTableUsageBody(
                    filters,
                    datePickerValue,
                    effectiveDimensions
                  ),
                });
                return result.data;
              }}
            />
          )}
          {!tableData.data && (
            <Alert variant="filled" severity="error">
              Failed to load cost table: {tableData.error?.errorMessage}
            </Alert>
          )}
        </AccordionDetails>
      </Accordion>
    </>
  );
}
