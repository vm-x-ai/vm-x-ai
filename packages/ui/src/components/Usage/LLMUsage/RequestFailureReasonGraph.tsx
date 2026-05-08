import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Alert from '@mui/material/Alert';
import React from 'react';
import type { DateRangePickerValue } from '../../DateRangePicker/types';
import { NamespaceGraph } from '../NamespaceGraph';
import { LLMRequestFailureReasonSummaryTable } from './RequestFailureReasonSummaryTable';
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
import { linePropsByTimeUnit, toNivoLineSerie } from '../utils/nivo';
import { MetricDefinition, MetricFormat } from '../types';
import { LineSeries, LineSvgProps } from '@nivo/line';

export type LLMRequestFailureReasonGraphProps = {
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

const baseDimensions = [
  RequestDimensions.PROVIDER,
  RequestDimensions.MODEL,
  RequestDimensions.FAILURE_REASON,
];

const metrics: MetricDefinition[] = [
  {
    name: 'errorCount',
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
  aggregations: RequestUsageQueryDto['agg'],
  filters: Record<string, string[]>,
  datePickerValue: DateRangePickerValue,
  effectiveDimensions: string[]
): RequestUsageQueryDto {
  const { dimensions, metadataDimensions } =
    splitDimensions(effectiveDimensions);
  return {
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
      provider: 'asc',
      model: 'asc',
      failureReason: 'asc',
    },
  };
}

export async function LLMRequestFailureReasonGraph({
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
}: LLMRequestFailureReasonGraphProps) {
  const aggregations: RequestUsageQueryDto['agg'] = {
    errorCount: 'sum',
  };
  const effectiveDimensions = resolveEffectiveDimensions(
    baseDimensions,
    metadataGroupBy,
    dimensionsOverride
  );

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

  const nivoLine = {
    ...linePropsByTimeUnit(granularity),
    data: toNivoLineSerie(
      result.data,
      effectiveDimensions,
      metrics.map((metric) => metric.name),
      'time'
    ),
  } as LineSvgProps<LineSeries>;

  const tableData = await getRequestUsage({
    path: {
      workspaceId,
      environmentId,
    },
    body: getTableUsageBody(
      aggregations,
      filters,
      datePickerValue,
      effectiveDimensions
    ),
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
            xLegend="LLM Requests"
            yLegend="requests"
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
                  effectiveDimensions,
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
            <LLMRequestFailureReasonSummaryTable
              data={tableData.data.filter(
                (item) => item.failureReason !== null
              )}
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
                    aggregations,
                    filters,
                    datePickerValue,
                    effectiveDimensions
                  ),
                });
                if (result.error) {
                  return undefined;
                }

                return result.data.filter(
                  (item) => item.failureReason !== null
                );
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
