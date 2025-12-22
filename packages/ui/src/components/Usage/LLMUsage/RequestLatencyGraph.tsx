import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Alert from '@mui/material/Alert';
import React from 'react';
import type { DateRangePickerValue } from '../../DateRangePicker/types';
import { NamespaceGraph } from '../NamespaceGraph';
import { LLMRequestLatencySummaryTable } from './RequestLatencySummaryTable';
import { parseDateRangePickerValueToAPIFilter } from './utils';
import {
  CompletionDimensions,
  CompletionUsageDimensionFilterDto,
  CompletionUsageDimensionOperator,
  CompletionUsageQueryDto,
  getCompletionUsage,
  GranularityUnit,
} from '@/clients/api';
import { linePropsByTimeUnit, toNivoLineSerie } from '../utils/nivo';
import { MetricDefinition, MetricFormat } from '../types';
import { LineSeries, LineSvgProps } from '@nivo/line';

export type LLMRequestLatencyGraphProps = {
  workspaceId: string;
  environmentId: string;
  granularity: GranularityUnit;
  filters: Record<string, string[]>;
  datePickerValue: DateRangePickerValue;
  autoRefresh: boolean;
  autoRefreshInterval?: number;
};

const dimensions = [
  CompletionDimensions.RESOURCE_ID,
  CompletionDimensions.PROVIDER,
  CompletionDimensions.CONNECTION_ID,
  CompletionDimensions.MODEL,
];

const metrics: MetricDefinition[] = [
  {
    name: 'requestDuration',
    type: 'double',
    format: MetricFormat.MILLISECONDS,
  },
];

function getUsageBody(
  aggregations: CompletionUsageQueryDto['agg'],
  granularity: GranularityUnit,
  filters: Record<string, string[]>,
  datePickerValue: DateRangePickerValue
): CompletionUsageQueryDto {
  return {
    granularity: granularity,
    dimensions,
    agg: aggregations,
    filter: {
      dateRange: parseDateRangePickerValueToAPIFilter(datePickerValue),
      fields: Object.entries(filters).reduce((acc, [key, value]) => {
        acc[key as CompletionDimensions] = {
          operator: CompletionUsageDimensionOperator.IN,
          value: value,
        };
        return acc;
      }, {} as Record<CompletionDimensions, CompletionUsageDimensionFilterDto>),
    },
    orderBy: {
      time: 'asc',
    },
  };
}

function getTableUsageBody(
  aggregations: CompletionUsageQueryDto['agg'],
  filters: Record<string, string[]>,
  datePickerValue: DateRangePickerValue
): CompletionUsageQueryDto {
  return {
    dimensions,
    agg: aggregations,
    filter: {
      dateRange: parseDateRangePickerValueToAPIFilter(datePickerValue),
      fields: Object.entries(filters).reduce((acc, [key, value]) => {
        acc[key as CompletionDimensions] = {
          operator: CompletionUsageDimensionOperator.IN,
          value: value,
        };
        return acc;
      }, {} as Record<CompletionDimensions, CompletionUsageDimensionFilterDto>),
    },
    orderBy: {
      provider: 'asc',
      model: 'asc',
    },
  };
}

export async function LLMRequestLatencyGraph({
  workspaceId,
  environmentId,
  granularity,
  filters,
  datePickerValue,
  autoRefresh,
  autoRefreshInterval,
}: LLMRequestLatencyGraphProps) {
  const aggregations: CompletionUsageQueryDto['agg'] = {
    requestDuration: 'p99',
  };

  const result = await getCompletionUsage({
    path: {
      workspaceId,
      environmentId,
    },
    body: getUsageBody(aggregations, granularity, filters, datePickerValue),
  });

  if (result.error) {
    return (
      <Alert variant="filled" severity="error">
        Failed to load line graph: {result.error.errorMessage}
      </Alert>
    );
  }

  const nivoLine = {
    ...linePropsByTimeUnit(granularity),
    data: toNivoLineSerie(
      result.data,
      dimensions,
      metrics.map((metric) => metric.name),
      'time'
    ),
  } as LineSvgProps<LineSeries>;

  const tableData = await getCompletionUsage({
    path: {
      workspaceId,
      environmentId,
    },
    body: getTableUsageBody(aggregations, filters, datePickerValue),
  });

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
            xLegend="LLM Requests Latency"
            yLegend="p99"
            autoRefresh={autoRefresh}
            autoRefreshInterval={autoRefreshInterval}
            autoRefreshAction={async () => {
              'use server';

              const result = await getCompletionUsage({
                path: {
                  workspaceId,
                  environmentId,
                },
                body: getUsageBody(
                  aggregations,
                  granularity,
                  filters,
                  datePickerValue
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
          aria-controls="panel2-content"
          id="panel2-header"
        >
          Summary Table
        </AccordionSummary>
        <AccordionDetails>
          {tableData.data && (
            <LLMRequestLatencySummaryTable
              data={tableData.data}
              autoRefresh={autoRefresh}
              autoRefreshInterval={autoRefreshInterval}
              autoRefreshAction={async () => {
                'use server';

                const result = await getCompletionUsage({
                  path: {
                    workspaceId,
                    environmentId,
                  },
                  body: getTableUsageBody(
                    aggregations,
                    filters,
                    datePickerValue
                  ),
                });
                if (result.error) {
                  return undefined;
                }

                return result.data;
              }}
            />
          )}
          {!tableData.data && (
            <Alert variant="filled" severity="error">
              Failed to load table data: {tableData.error?.errorMessage}
            </Alert>
          )}
        </AccordionDetails>
      </Accordion>
    </>
  );
}
