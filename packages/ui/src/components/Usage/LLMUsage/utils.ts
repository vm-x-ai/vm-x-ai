import {
  RequestDimensions,
  RequestUsageQueryDateRangeDto,
} from '@/clients/api';
import type { DateRangePickerValue } from '../../DateRangePicker/types';
import { parseDateRangePickerValue } from '../../DateRangePicker/utils';

function parseDate(date?: Date): string {
  const value = date || new Date();
  return value.toISOString();
}

export function parseDateRangePickerValueToAPIFilter(
  value: DateRangePickerValue
): RequestUsageQueryDateRangeDto {
  const { start, end } = parseDateRangePickerValue(value, parseDate);

  return {
    start: start,
    end: end,
  };
}

/**
 * Merge a chart's fixed dimensions with the metadata-group-by selections from
 * the URL state. The metadata keys come in unprefixed (`tenant_id`) and the
 * backend expects them as `metadata.<key>`.
 *
 * Returns the same array shape charts already pass to `getRequestUsage` so
 * existing call sites only have to change one line.
 */
export function dimensionsWithMetadata(
  base: string[],
  metadataGroupBy: string[] = []
): string[] {
  if (metadataGroupBy.length === 0) return base;
  const metadataDims = metadataGroupBy.map((k) => `metadata.${k}`);
  return [...base, ...metadataDims];
}

const KNOWN_BASE_DIMENSIONS: ReadonlySet<string> = new Set(
  Object.values(RequestDimensions)
);

/**
 * Per-chart group-by overrides store fully-qualified strings: bare
 * `RequestDimensions` enum values for base dimensions
 * (`provider`, `connectionId`, …) and `metadata.<key>` strings for
 * metadata. Older URLs may still hold bare metadata keys
 * (`tenant_id`); normalise those by prefixing `metadata.` so the API
 * payload is correct either way.
 */
function normalizeOverride(override: string[]): string[] {
  return override.map((entry) => {
    if (!entry) return entry;
    if (entry.startsWith('metadata.')) return entry;
    if (KNOWN_BASE_DIMENSIONS.has(entry)) return entry;
    return `metadata.${entry}`;
  });
}

/**
 * Resolve a chart's effective dimension list. When the per-chart
 * override is non-empty it wins outright; otherwise we fall back to
 * the chart's hardcoded base dimensions joined with the page-wide
 * metadata-group-by selections (turned into `metadata.<key>` strings).
 */
export function resolveEffectiveDimensions(
  baseDimensions: string[],
  metadataGroupBy: string[],
  override?: string[]
): string[] {
  if (override && override.length > 0) return normalizeOverride(override);
  return [...baseDimensions, ...metadataGroupBy.map((k) => `metadata.${k}`)];
}

/**
 * Split a fully-qualified effective dimension list into the base /
 * metadata arrays the API payload expects.
 */
export function splitDimensions(effective: string[]): {
  dimensions: RequestDimensions[];
  metadataDimensions: string[];
} {
  const dimensions: RequestDimensions[] = [];
  const metadataDimensions: string[] = [];
  for (const d of effective) {
    if (d.startsWith('metadata.')) metadataDimensions.push(d);
    else dimensions.push(d as RequestDimensions);
  }
  return { dimensions, metadataDimensions };
}
