import Alert from '@mui/material/Alert';
import Grid from '@mui/material/Grid';
import Paper from '@mui/material/Paper';
import Skeleton from '@mui/material/Skeleton';
import Typography from '@mui/material/Typography';
import {
  RequestUsageDimensionFilterDto,
  RequestUsageDimensionOperator,
  RequestUsageQueryDto,
  RequestDimensions,
  getRequestUsage,
} from '@/clients/api';
import { formatCurrency } from '@/utils/number';
import type { DateRangePickerValue } from '../../DateRangePicker/types';
import { parseDateRangePickerValueToAPIFilter } from './utils';

export type UsageTotalsBarProps = {
  workspaceId: string;
  environmentId: string;
  filters: Record<string, string[]>;
  datePickerValue: DateRangePickerValue;
};

const compactNumber = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 2,
});

function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '0';
  return compactNumber.format(value);
}

type Tile = {
  label: string;
  value: string;
};

function StatTile({ label, value }: Tile) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
      }}
    >
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ letterSpacing: '0.04em', fontWeight: 600 }}
      >
        {label}
      </Typography>
      <Typography
        variant="h4"
        sx={{ fontWeight: 700, lineHeight: 1.1, mt: 'auto' }}
      >
        {value}
      </Typography>
    </Paper>
  );
}

export function UsageTotalsBarLoading() {
  return (
    <Grid container spacing={2}>
      {Array.from({ length: 4 }).map((_, i) => (
        <Grid key={i} size={{ xs: 12, sm: 6, md: 3 }}>
          <Skeleton variant="rounded" height={96} />
        </Grid>
      ))}
    </Grid>
  );
}

/**
 * Top-of-page summary tiles: total cost + token breakdown for the
 * selected window/filters. Mirrors Datadog-style "big number" cards
 * — one query with no `dimensions` returns a single aggregated row.
 */
export async function UsageTotalsBar({
  workspaceId,
  environmentId,
  filters,
  datePickerValue,
}: UsageTotalsBarProps) {
  const body: RequestUsageQueryDto = {
    dimensions: [],
    agg: {
      totalCost: 'sum',
      promptTokens: 'sum',
      outputTokens: 'sum',
      cachedTokens: 'sum',
    },
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
  };

  const result = await getRequestUsage({
    path: { workspaceId, environmentId },
    body,
  });

  if (result.error) {
    return (
      <Alert variant="filled" severity="error">
        Failed to load totals: {result.error.errorMessage}
      </Alert>
    );
  }

  // No dimensions + no granularity → API collapses to a single row
  // covering the whole window. Empty result means zero matching
  // requests; render zeros rather than dashes so the tiles stay
  // visually consistent on quiet workspaces.
  const row = result.data?.[0];
  const totalCost = Number(row?.totalCost ?? 0);
  const promptTokens = Number(row?.promptTokens ?? 0);
  const outputTokens = Number(row?.outputTokens ?? 0);
  const cachedTokens = Number(row?.cachedTokens ?? 0);

  const tiles: Tile[] = [
    { label: 'TOTAL COST', value: formatCurrency(totalCost) },
    { label: 'INPUT TOKENS', value: formatTokens(promptTokens) },
    { label: 'OUTPUT TOKENS', value: formatTokens(outputTokens) },
    { label: 'CACHED TOKENS', value: formatTokens(cachedTokens) },
  ];

  return (
    <Grid container spacing={2}>
      {tiles.map((tile) => (
        <Grid key={tile.label} size={{ xs: 12, sm: 6, md: 3 }}>
          <StatTile label={tile.label} value={tile.value} />
        </Grid>
      ))}
    </Grid>
  );
}
