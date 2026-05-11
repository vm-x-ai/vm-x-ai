'use client';

import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import { useColorScheme } from '@mui/material/styles';
import React from 'react';

/**
 * Light/dark mode toggle for the app bar. Uses MUI's useColorScheme
 * (relies on cssVariables.colorSchemeSelector === 'data' in theme.ts);
 * persistence to localStorage is handled by MUI internally.
 *
 * SSR-safe: the hook returns undefined `mode` during the first render,
 * in which case we fall back to a neutral "light" assumption so the icon
 * doesn't flash. The InitColorSchemeScript in layout.tsx ensures the
 * actual rendered theme matches user preference from the very first paint.
 */
export default function ThemeToggle() {
  const { mode, setMode } = useColorScheme();

  if (!mode) {
    // Render a placeholder of the same size to avoid layout shift on hydration.
    return (
      <IconButton color="inherit" disabled aria-hidden>
        <LightModeIcon />
      </IconButton>
    );
  }

  const isDark = mode === 'dark';

  return (
    <Tooltip title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}>
      <IconButton
        color="inherit"
        onClick={() => setMode(isDark ? 'light' : 'dark')}
        aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        {isDark ? <LightModeIcon /> : <DarkModeIcon />}
      </IconButton>
    </Tooltip>
  );
}
