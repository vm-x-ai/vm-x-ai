import Alert from '@mui/material/Alert';
import {
  RequestDimensions,
  RequestUsageDimensionFilterDto,
  RequestUsageDimensionOperator,
  RequestUsageQueryDto,
  getRequestUsage,
} from '@/clients/api';
import type { DateRangePickerValue } from '../../DateRangePicker/types';
import { parseDateRangePickerValueToAPIFilter } from './utils';
import TopByCostBarClient from './TopByCostBarClient';

export type TopByCostBarProps = {
  workspaceId: string;
  environmentId: string;
  filters: Record<string, string[]>;
  datePickerValue: DateRangePickerValue;
  /** Which dimension to break the cost down by. */
  dimension: RequestDimensions;
  /** Section heading rendered above the chart. */
  title: string;
  /** Optional caption explaining what's shown. */
  caption?: string;
  /** How many top rows to show. Defaults to 10. */
  limit?: number;
  /**
   * Optional id-to-label map. If provided, dimension values are mapped
   * before rendering. Useful for `apiKeyId` → friendly key name.
   */
  labelMap?: Record<string, string>;
};

/**
 * Server-side data fetcher for the "top N by cost" cards. Sums
 * `totalCost` over the selected window grouped by a single dimension
 * (e.g. `apiKeyId`, `correlationId`), sorts DESC, and hands the top
 * `limit` rows to the client renderer.
 *
 * Used by the new "Top API keys by cost" and "Top correlationIds by
 * cost" sections on the Usage page.
 */
export async function TopByCostBar({
  workspaceId,
  environmentId,
  filters,
  datePickerValue,
  dimension,
  title,
  caption,
  limit = 10,
  labelMap,
}: TopByCostBarProps) {
  const body: RequestUsageQueryDto = {
    dimensions: [dimension],
    agg: { totalCost: 'sum' },
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
    orderBy: { totalCost: 'desc' },
  };
  const result = await getRequestUsage({
    path: { workspaceId, environmentId },
    body,
  });

  if (result.error) {
    return (
      <Alert severity="error" variant="outlined">
        Failed to load {title}: {result.error.errorMessage}
      </Alert>
    );
  }

  const rows = (result.data ?? [])
    .filter((r: Record<string, unknown>) => r[dimension] != null)
    .slice(0, limit)
    .map((r: Record<string, unknown>) => {
      const key = String(r[dimension]);
      return {
        key,
        cost: Number(r.totalCost ?? 0),
        label: labelMap?.[key],
      };
    });

  return <TopByCostBarClient rows={rows} title={title} caption={caption} />;
}
