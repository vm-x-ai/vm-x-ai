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
import { linePropsByTimeUnit, toNivoLineSerie } from '../utils/nivo';
import type { DateRangePickerValue } from '../../DateRangePicker/types';
import {
  parseDateRangePickerValueToAPIFilter,
  resolveEffectiveDimensions,
  splitDimensions,
} from './utils';

export type ErrorsByStatusCodeGraphProps = {
  workspaceId: string;
  environmentId: string;
  granularity: GranularityUnit;
  filters: Record<string, string[]>;
  datePickerValue: DateRangePickerValue;
  autoRefresh: boolean;
  autoRefreshInterval?: number;
  /** Group additionally by these metadata keys when set. */
  metadataGroupBy?: string[];
  /** Per-chart group-by override (fully-qualified strings). When
   *  non-empty, replaces the chart's defaults entirely. */
  dimensionsOverride?: string[];
  /** When true, group by `failureReason` instead of `statusCode`. */
  byFailureReason?: boolean;
  chartId?: string;
  metadataKeys?: string[];
};

const baseMetrics: MetricDefinition[] = [
  { name: 'errorCount', type: 'bigint', format: MetricFormat.NUMBER },
];

/**
 * Errors over time, broken down either by HTTP status code (default) or
 * by `failureReason`. Lets ops find when 429/5xx spikes happened and
 * which provider/route was responsible (when grouped by metadata).
 */
export async function ErrorsByStatusCodeGraph({
  workspaceId,
  environmentId,
  granularity,
  filters,
  datePickerValue,
  autoRefresh,
  autoRefreshInterval,
  metadataGroupBy = [],
  dimensionsOverride,
  byFailureReason = false,
  chartId,
  metadataKeys = [],
}: ErrorsByStatusCodeGraphProps) {
  const breakdown = byFailureReason
    ? RequestDimensions.FAILURE_REASON
    : RequestDimensions.STATUS_CODE;
  const baseDimensions = [breakdown];
  const effectiveDimensions = resolveEffectiveDimensions(
    baseDimensions,
    metadataGroupBy,
    dimensionsOverride
  );
  const { dimensions: apiDimensions, metadataDimensions } =
    splitDimensions(effectiveDimensions);

  const body: RequestUsageQueryDto = {
    granularity,
    dimensions: apiDimensions,
    metadataDimensions,
    agg: { errorCount: 'sum' },
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
  };

  const result = await getRequestUsage({
    path: { workspaceId, environmentId },
    body,
  });
  if (result.error) {
    return (
      <Alert variant="filled" severity="error">
        Failed to load errors graph: {result.error.errorMessage}
      </Alert>
    );
  }

  const nivoLine = {
    ...linePropsByTimeUnit(granularity),
    data: toNivoLineSerie(
      result.data,
      effectiveDimensions,
      baseMetrics.map((m) => m.name),
      'time'
    ),
  } as LineSvgProps<LineSeries>;

  return (
    <Accordion
      defaultExpanded
      slotProps={{ transition: { unmountOnExit: true } }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        Errors by {byFailureReason ? 'failure reason' : 'status code'}
      </AccordionSummary>
      <AccordionDetails>
        <NamespaceGraph
          data={nivoLine}
          metrics={baseMetrics}
          agg={{ errorCount: 'sum' }}
          xLegend="Time"
          yLegend="errors"
          chartId={chartId}
          metadataKeys={metadataKeys}
          baseDimensionOptions={baseDimensions}
          effectiveGroupBy={effectiveDimensions}
          autoRefresh={autoRefresh}
          autoRefreshInterval={autoRefreshInterval}
          autoRefreshAction={async () => {
            'use server';
            const r = await getRequestUsage({
              path: { workspaceId, environmentId },
              body,
            });
            if (r.error) return undefined;
            return {
              ...linePropsByTimeUnit(granularity),
              data: toNivoLineSerie(
                r.data,
                effectiveDimensions,
                baseMetrics.map((m) => m.name),
                'time'
              ),
            } as LineSvgProps<LineSeries>;
          }}
        />
      </AccordionDetails>
    </Accordion>
  );
}
