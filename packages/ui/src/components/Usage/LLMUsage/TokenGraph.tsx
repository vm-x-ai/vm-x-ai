import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Alert from '@mui/material/Alert';
import React from 'react';
import type { DateRangePickerValue } from '../../DateRangePicker/types';
import { NamespaceGraph } from '../NamespaceGraph';
import { LLMTokenSummaryTable } from './TokenSummaryTable';
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

export type LLMTokenGraphProps = {
  workspaceId: string;
  environmentId: string;
  granularity: GranularityUnit;
  filters: Record<string, string[]>;
  datePickerValue: DateRangePickerValue;
  autoRefresh: boolean;
  autoRefreshInterval?: number;
  metadataGroupBy?: string[];
  dimensionsOverride?: string[];
  chartId?: string;
  metadataKeys?: string[];
};

const baseDimensions = [RequestDimensions.PROVIDER, RequestDimensions.MODEL];

const metrics: MetricDefinition[] = [
  {
    name: 'outputTokens',
    type: 'bigint',
    format: MetricFormat.NUMBER,
  },
  {
    name: 'promptTokens',
    type: 'bigint',
    format: MetricFormat.NUMBER,
  },
];

function getUsageBody(
  aggregations: RequestUsageQueryDto['agg'],
  granularity: GranularityUnit,
  filters: Record<string, string[]>,
  datePickerValue: DateRangePickerValue,
  effectiveDimensions: string[]
): RequestUsageQueryDto {
  const { dimensions, metadataDimensions } =
    splitDimensions(effectiveDimensions);
  return {
    granularity: granularity,
    dimensions,
    metadataDimensions,
    agg: aggregations,
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
    agg: {
      outputTokens: 'sum',
      promptTokens: 'sum',
      totalTokens: 'sum',
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

export async function LLMTokenGraph({
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
}: LLMTokenGraphProps) {
  const aggregations: RequestUsageQueryDto['agg'] = {
    promptTokens: 'sum',
    outputTokens: 'sum',
  };
  const effectiveDimensions = resolveEffectiveDimensions(
    baseDimensions,
    metadataGroupBy,
    dimensionsOverride
  );
  const dimensions = effectiveDimensions;

  const result = await getRequestUsage({
    path: {
      workspaceId,
      environmentId,
    },
    body: getUsageBody(
      aggregations,
      granularity,
      filters,
      datePickerValue,
      effectiveDimensions
    ),
  });

  if (result.error) {
    return (
      <Alert variant="filled" severity="error">
        Failed to load line graph: {result.error.errorMessage}
      </Alert>
    );
  }

  const tableData = await getRequestUsage({
    path: {
      workspaceId,
      environmentId,
    },
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
            xLegend="LLM Tokens"
            yLegend="Tokens"
            chartId={chartId}
            metadataKeys={metadataKeys}
            baseDimensionOptions={baseDimensions}
            effectiveGroupBy={effectiveDimensions}
            autoRefresh={autoRefresh}
            autoRefreshInterval={autoRefreshInterval}
            autoRefreshAction={async () => {
              'use server';

              const result = await getRequestUsage({
                path: {
                  workspaceId,
                  environmentId,
                },
                body: getUsageBody(
                  aggregations,
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
          aria-controls="panel2-content"
          id="panel2-header"
        >
          Summary Table
        </AccordionSummary>
        <AccordionDetails>
          {tableData.data && (
            <LLMTokenSummaryTable
              data={tableData.data}
              autoRefresh={autoRefresh}
              autoRefreshInterval={autoRefreshInterval}
              autoRefreshAction={async () => {
                'use server';

                const result = await getRequestUsage({
                  path: {
                    workspaceId,
                    environmentId,
                  },
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
              Failed to load table data: {tableData.error?.errorMessage}
            </Alert>
          )}
        </AccordionDetails>
      </Accordion>
    </>
  );
}
