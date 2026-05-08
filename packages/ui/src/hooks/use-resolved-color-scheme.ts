'use client';

import { useColorScheme } from '@mui/material/styles';

/**
 * Resolve MUI's color scheme to a concrete `'light'` or `'dark'`,
 * folding the `'system'` mode through `systemMode` so callers don't
 * have to repeat the same five-line pattern in every component that
 * needs the active scheme (Monaco theme, MRT base background, etc.).
 *
 * Falls back to `'light'` when neither is resolved — happens during
 * the first SSR render before `InitColorSchemeScript` runs on the
 * client.
 */
export function useResolvedColorScheme(): 'light' | 'dark' {
  const { mode, systemMode } = useColorScheme();
  const resolved = mode === 'system' ? systemMode : mode;
  return resolved === 'dark' ? 'dark' : 'light';
}
