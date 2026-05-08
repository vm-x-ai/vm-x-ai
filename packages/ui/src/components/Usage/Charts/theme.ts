import type { Theme } from '@mui/material/styles';

/**
 * Nivo chart theme derived from MUI's theme.
 *
 * **Why CSS variables, not `theme.palette.*` reads.** This app enables
 * `cssVariables` + `colorSchemeSelector: 'data'`, which means runtime
 * mode switches happen by flipping CSS custom-property values on the
 * `<html>` tag — `theme.palette.text.primary` evaluated in JS still
 * returns the *default* (light) scheme's static string and never
 * updates when the user toggles dark mode. Nivo applies fills/strokes
 * via React's `style` prop so the `var(--mui-palette-*)` references
 * resolve at paint time and track the active scheme correctly.
 *
 * Axis/tick rules and grid lines use `color-mix` against
 * `text.primary` instead of `divider` because divider is sized for
 * 1px borders between surfaces (rgba(…,0.12) in dark mode → invisible
 * across a wide chart canvas). Same reasoning for tick labels: I want
 * them to track the foreground colour, not the surface-edge contrast.
 */
const textPrimary = 'var(--mui-palette-text-primary)';
const backgroundPaper = 'var(--mui-palette-background-paper)';
const dividerColor = 'var(--mui-palette-divider)';
// Axis/tick rules — visible without competing with the data series.
const lineColor = `color-mix(in srgb, ${textPrimary} 30%, transparent)`;
// Grid — present but recessive.
const gridColor = `color-mix(in srgb, ${textPrimary} 16%, transparent)`;

// `theme` is intentionally unused now (everything sources from CSS
// variables) but kept on the signature so callers who pass MUI's
// theme don't need to change.
export const nivoTheme = (_theme: Theme) => ({
  background: 'transparent',
  text: {
    fontSize: 11,
    fill: textPrimary,
    outlineWidth: 0,
    outlineColor: 'transparent',
  },
  crosshair: {
    line: {
      stroke: textPrimary,
      strokeWidth: 1,
      strokeOpacity: 0.75,
      strokeDasharray: '6 6',
    },
  },
  axis: {
    domain: {
      line: {
        stroke: lineColor,
        strokeWidth: 1,
      },
    },
    legend: {
      text: {
        fontSize: 12,
        fill: textPrimary,
        outlineWidth: 0,
        outlineColor: 'transparent',
      },
    },
    ticks: {
      line: {
        stroke: lineColor,
        strokeWidth: 1,
      },
      text: {
        fontSize: 11,
        fill: textPrimary,
        outlineWidth: 0,
        outlineColor: 'transparent',
      },
    },
  },
  grid: {
    line: {
      stroke: gridColor,
      strokeWidth: 1,
    },
  },
  legends: {
    title: {
      text: {
        fontSize: 11,
        fill: textPrimary,
        outlineWidth: 0,
        outlineColor: 'transparent',
      },
    },
    text: {
      fontSize: 11,
      fill: textPrimary,
      outlineWidth: 0,
      outlineColor: 'transparent',
    },
    ticks: {
      line: {},
      text: {
        fontSize: 10,
        fill: textPrimary,
        outlineWidth: 0,
        outlineColor: 'transparent',
      },
    },
  },
  annotations: {
    text: {
      fontSize: 13,
      fill: textPrimary,
      outlineWidth: 2,
      outlineColor: backgroundPaper,
      outlineOpacity: 1,
    },
    link: {
      stroke: textPrimary,
      strokeWidth: 1,
      outlineWidth: 2,
      outlineColor: backgroundPaper,
      outlineOpacity: 1,
    },
    outline: {
      stroke: textPrimary,
      strokeWidth: 2,
      outlineWidth: 2,
      outlineColor: backgroundPaper,
      outlineOpacity: 1,
    },
    symbol: {
      fill: textPrimary,
      outlineWidth: 2,
      outlineColor: backgroundPaper,
      outlineOpacity: 1,
    },
  },
  tooltip: {
    container: {
      background: backgroundPaper,
      color: textPrimary,
      border: `1px solid ${dividerColor}`,
      fontSize: 12,
    },
    basic: {},
    chip: {},
    table: {},
    tableCell: {},
    tableCellValue: {},
  },
});
