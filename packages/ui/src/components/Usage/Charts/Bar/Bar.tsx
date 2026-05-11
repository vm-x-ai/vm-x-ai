'use client';

import { useTheme } from '@nivo/theming';
import type { BarSvgProps } from '@nivo/bar';
import { ResponsiveBar } from '@nivo/bar';
import { numberWithCommas } from '@/utils/number';
import type { LineSeries } from '@nivo/line';
import React, { useMemo } from 'react';

/**
 * Bar-chart variant of the usage line chart. Same data contract — we
 * accept Nivo `LineSeries` so callers can flip between Line and Bar
 * without rebuilding their dataset.
 *
 * Each `LineSeries.id` becomes a series key on each bar group. The
 * x-value (timestamp / category) becomes the indexBy axis. Series are
 * stacked when there's more than one, matching how Line renders them
 * with `enableArea`.
 */
type BarDatum = Record<string, string | number> & { x: string };

const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * Minimal d3-time-format-compatible substitution. Supports the
 * tokens emitted by the Line chart's axis configs (see
 * `Usage/utils/nivo/line/properties.ts`):
 *   `%Y` 4-digit year, `%m` 2-digit month, `%d` 2-digit day,
 *   `%H` 2-digit hour, `%M` 2-digit minute, `%S` 2-digit second,
 *   `%b` short month name, `%%` literal percent.
 *
 * Anything else passes through unchanged so the user still sees
 * something readable rather than a runtime crash.
 */
function applyTimeFormat(pattern: string, date: Date): string {
  return pattern.replace(/%[YmdHMSb%]/g, (token) => {
    switch (token) {
      case '%Y':
        return String(date.getFullYear());
      case '%m':
        return pad2(date.getMonth() + 1);
      case '%d':
        return pad2(date.getDate());
      case '%H':
        return pad2(date.getHours());
      case '%M':
        return pad2(date.getMinutes());
      case '%S':
        return pad2(date.getSeconds());
      case '%b':
        return MONTHS_SHORT[date.getMonth()];
      case '%%':
        return '%';
      default:
        return token;
    }
  });
}

export type BarChartProps = {
  data: LineSeries[];
  /** Reuse axisBottom/axisLeft formatting from the Line variant. */
  axisBottom?: BarSvgProps<BarDatum>['axisBottom'];
  axisLeft?: BarSvgProps<BarDatum>['axisLeft'];
  /** Same y-format passthrough as the Line chart's `yFormat`. */
  yFormat?: BarSvgProps<BarDatum>['valueFormat'];
};

export default function BarChart({
  data,
  axisBottom,
  axisLeft,
  yFormat,
}: BarChartProps) {
  const theme = useTheme();

  const { keys, indexedData } = useMemo(() => {
    const seriesKeys = data.map((s) => String(s.id));

    // Index each row by its x-value. Bar charts need flat objects:
    //   { x: '2026-05-06T00:00', requests: 12, errors: 1 }
    // Line gives us { id, data: [{x, y}, ...] } — invert it.
    const xMap = new Map<string, BarDatum>();
    for (const series of data) {
      for (const point of series.data) {
        const xRaw = point.x;
        const x = xRaw instanceof Date ? xRaw.toISOString() : String(xRaw);
        if (!xMap.has(x)) {
          xMap.set(x, { x } as BarDatum);
        }
        const row = xMap.get(x);
        if (row) {
          // Nivo's LineSeries `y` can be number | string | Date.
          // Bar charts need a number; coerce defensively. NaN
          // (Nivo's missing-value sentinel) becomes 0 so the bar
          // renders as zero-height instead of breaking the scale.
          const yRaw = point.y;
          let yNum = 0;
          if (typeof yRaw === 'number') yNum = Number.isFinite(yRaw) ? yRaw : 0;
          else if (typeof yRaw === 'string') {
            const parsed = Number(yRaw);
            yNum = Number.isFinite(parsed) ? parsed : 0;
          } else if (yRaw instanceof Date) yNum = yRaw.getTime();
          row[String(series.id)] = yNum;
        }
      }
    }
    return {
      keys: seriesKeys,
      indexedData: Array.from(xMap.values()),
    };
  }, [data]);

  // The Line variant passes `axisBottom.format` as a d3-time-format
  // string (e.g. `'%H:%M'`) — Nivo's Line treats it as a time format
  // because the X scale is `time`. Bar's X scale is `band`, so Nivo
  // hands the same string to d3-format which throws
  // `invalid format: %H:%M`. Detect the time-format pattern and wrap
  // it in a function that parses the ISO timestamp first. Only the
  // tokens used in `Usage/utils/nivo/line/properties.ts` are
  // supported (`%Y %m %d %H %M %S %b`); a richer formatter would
  // pull in the whole d3-time-format ESM package for one-call use.
  const axisBottomNormalized = useMemo(() => {
    if (!axisBottom) return undefined;
    const fmt = (axisBottom as { format?: unknown }).format;
    if (typeof fmt !== 'string' || !fmt.includes('%')) {
      return axisBottom;
    }
    return {
      ...axisBottom,
      format: (value: string) => {
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? value : applyTimeFormat(fmt, d);
      },
    };
  }, [axisBottom]);

  return (
    <ResponsiveBar
      theme={theme}
      data={indexedData}
      keys={keys}
      indexBy="x"
      colors={{ scheme: 'tableau10' }}
      margin={{ top: 50, right: 200, bottom: 100, left: 100 }}
      padding={0.2}
      groupMode={keys.length > 1 ? 'stacked' : 'grouped'}
      valueFormat={yFormat}
      axisBottom={{
        tickSize: 5,
        tickPadding: 5,
        tickRotation: 0,
        legendOffset: 36,
        legendPosition: 'middle',
        ...(axisBottomNormalized ?? {}),
      }}
      axisLeft={{
        tickSize: 5,
        tickPadding: 5,
        tickRotation: 0,
        legendOffset: -70,
        legendPosition: 'middle',
        ...(axisLeft ?? {}),
      }}
      enableLabel={false}
      tooltip={({ id, value, color, indexValue }) => (
        <div
          style={{
            background: theme.tooltip.container.background,
            color: theme.tooltip.container.color,
            border: theme.tooltip.container.border,
            padding: '9px 12px',
            borderRadius: '3px',
            whiteSpace: 'nowrap',
          }}
        >
          <div>{String(indexValue)}</div>
          <div style={{ color, padding: '3px 0' }}>
            <strong>{String(id)}</strong> [{numberWithCommas(value)}]
          </div>
        </div>
      )}
      legends={[
        {
          dataFrom: 'keys',
          anchor: 'bottom-right',
          direction: 'column',
          justify: false,
          translateX: 100,
          translateY: 0,
          itemsSpacing: 0,
          itemDirection: 'left-to-right',
          itemWidth: 80,
          itemHeight: 20,
          itemOpacity: 0.75,
          symbolSize: 12,
          symbolShape: 'square',
        },
      ]}
    />
  );
}
