import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Alert from '@mui/material/Alert';
import {
  RequestDimensions,
  RequestUsageDimensionFilterDto,
  RequestUsageDimensionOperator,
  RequestUsageQueryDto,
  getRequestUsage,
  GranularityUnit,
} from '@/clients/api';
import type { LineSeries, LineSvgProps } from '@nivo/line';
import { NamespaceGraph } from '../NamespaceGraph';
import { MetricDefinition, MetricFormat } from '../types';
import { linePropsByTimeUnit } from '../utils/nivo';
import type { DateRangePickerValue } from '../../DateRangePicker/types';
import { parseDateRangePickerValueToAPIFilter } from './utils';

export type LatencyPercentilesGraphProps = {
  workspaceId: string;
  environmentId: string;
  granularity: GranularityUnit;
  filters: Record<string, string[]>;
  datePickerValue: DateRangePickerValue;
  autoRefresh: boolean;
  autoRefreshInterval?: number;
};

const metrics: MetricDefinition[] = [
  {
    name: 'requestDuration',
    type: 'double',
    format: MetricFormat.MILLISECONDS,
  },
];

/**
 * Latency p50/p95/p99 of `requestDuration` over time. Backed by three
 * concurrent agg queries — one per percentile — joined client-side
 * into a 3-series Nivo line dataset. Ops uses these for SLO tracking;
 * averages alone hide the long tail.
 */
export async function LatencyPercentilesGraph({
  workspaceId,
  environmentId,
  granularity,
  filters,
  datePickerValue,
  autoRefresh,
  autoRefreshInterval,
}: LatencyPercentilesGraphProps) {
  const buildBody = (agg: 'avg' | 'p95' | 'p99'): RequestUsageQueryDto => ({
    granularity,
    dimensions: [],
    agg: { requestDuration: agg },
    filter: {
      dateRange: parseDateRangePickerValueToAPIFilter(datePickerValue),
      fields: Object.entries(filters).reduce((acc, [key, value]) => {
        acc[key as RequestDimensions] = {
          operator: RequestUsageDimensionOperator.IN,
          value,
        };
        return acc;
      }, {} as Record<RequestDimensions, RequestUsageDimensionFilterDto>),
    },
    orderBy: { time: 'asc' },
  });

  const [p50, p95, p99] = await Promise.all([
    getRequestUsage({
      path: { workspaceId, environmentId },
      body: buildBody('avg'),
    }),
    getRequestUsage({
      path: { workspaceId, environmentId },
      body: buildBody('p95'),
    }),
    getRequestUsage({
      path: { workspaceId, environmentId },
      body: buildBody('p99'),
    }),
  ]);

  const firstError = [p50, p95, p99].find((r) => r.error)?.error;
  if (firstError) {
    return (
      <Alert variant="filled" severity="error">
        Failed to load latency percentiles: {firstError.errorMessage}
      </Alert>
    );
  }

  const toSeries = (
    data: Array<Record<string, unknown>> | undefined,
    label: string
  ): LineSeries => ({
    id: label,
    data:
      (data ?? []).map((row) => ({
        x: new Date(row.time as string),
        y: Number(row.requestDuration ?? 0),
      })) ?? [],
  });

  const nivoLine = {
    ...linePropsByTimeUnit(granularity),
    data: [
      toSeries(p50.data, 'avg (~p50)'),
      toSeries(p95.data, 'p95'),
      toSeries(p99.data, 'p99'),
    ],
  } as LineSvgProps<LineSeries>;

  return (
    <Accordion
      defaultExpanded
      slotProps={{ transition: { unmountOnExit: true } }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        Request latency — avg (~p50), p95, p99
      </AccordionSummary>
      <AccordionDetails>
        <NamespaceGraph
          data={nivoLine}
          metrics={metrics}
          agg={{ requestDuration: 'avg' }}
          xLegend="Time"
          yLegend="ms"
          autoRefresh={autoRefresh}
          autoRefreshInterval={autoRefreshInterval}
        />
      </AccordionDetails>
    </Accordion>
  );
}
