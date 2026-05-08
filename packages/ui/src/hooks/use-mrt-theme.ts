'use client';

import { useResolvedColorScheme } from './use-resolved-color-scheme';

/**
 * Workaround for [material-react-table v3 #1429](https://github.com/KevinVandy/material-react-table/issues/1429):
 * MRT calls `lighten()` on its internal `baseBackgroundColor` to derive other
 * surface tones, and that helper rejects CSS-variable strings. Combined with
 * MUI v6 `cssVariables: { colorSchemeSelector: 'data' }`, this means the
 * default `Paper` renders with the *initial* scheme color (white) and never
 * flips on toggle.
 *
 * This hook returns the props each `useMaterialReactTable({ ... })` site
 * needs to spread so the table reflects the active light/dark scheme:
 *
 * ```tsx
 * const mrtThemeProps = useMrtTheme();
 * const table = useMaterialReactTable({
 *   ...
 *   ...mrtThemeProps,
 * });
 * ```
 *
 * The visible surfaces (Paper, table head, table body, bottom toolbar)
 * use the raw CSS variable string so the browser resolves them via
 * `data-mui-color-scheme` — set by `InitColorSchemeScript` on `<html>`
 * before React hydrates. That's the only way to avoid a "white flash"
 * on first paint when the user's stored mode is dark: `useColorScheme`
 * returns undefined on the server, so any JS-resolved value renders
 * light, then re-renders dark on hydration.
 *
 * `mrtTheme.baseBackgroundColor` keeps the resolved hex because MRT
 * calls `lighten()` on it for derived tints (menu, hover, selected
 * row). Those tints only show after interaction, so a brief mismatch
 * isn't visible on first paint — and `lighten()` doesn't accept CSS
 * variable strings (see MRT v3 #1429).
 *
 * Also caps the table paper at the available width so wide tables
 * scroll horizontally inside their `<AppContainer>` instead of pushing
 * the page chrome (sidebar, breadcrumb, container border) off-screen.
 */
export function useMrtTheme() {
  const activeMode = useResolvedColorScheme();
  const paperBackgroundHex = activeMode === 'dark' ? '#0a0a0a' : '#ffffff';
  const paperBackgroundVar = 'var(--mui-palette-background-paper)';

  return {
    muiTablePaperProps: {
      sx: {
        backgroundColor: paperBackgroundVar,
        // Removes the Paper elevation gradient that overlays
        // `bgcolor` in dark mode and lightens it past #0a0a0a.
        backgroundImage: 'none',
        width: '100%',
        maxWidth: '100%',
      },
    },
    muiTableHeadProps: {
      sx: { backgroundColor: paperBackgroundVar },
    },
    muiTableHeadCellProps: {
      sx: { backgroundColor: paperBackgroundVar },
    },
    muiTableBodyProps: {
      sx: { backgroundColor: paperBackgroundVar },
    },
    // Cells fill the row visually, so painting them is enough to mask
    // any first-paint flicker from MRT's internal `baseBackgroundColor`
    // hex (which can't be a CSS variable — see comment above). Several
    // table sites override `muiTableBodyRowProps` with their own
    // hover/click callback, so that slot is left alone here to avoid
    // silently shadowing those callbacks via spread order.
    muiTableBodyCellProps: {
      sx: { backgroundColor: paperBackgroundVar },
    },
    muiBottomToolbarProps: {
      sx: { backgroundColor: paperBackgroundVar },
    },
    muiTopToolbarProps: {
      sx: { backgroundColor: paperBackgroundVar },
    },
    mrtTheme: {
      baseBackgroundColor: paperBackgroundHex,
    },
  } as const;
}
