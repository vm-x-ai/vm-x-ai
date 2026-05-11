'use client';

import { createTheme } from '@mui/material/styles';
import { Inter, JetBrains_Mono } from 'next/font/google';

/**
 * Typography choice — Inter is Geist-adjacent (Vercel's house font is
 * Geist Sans, designed by the Inter author), and ships free via Google
 * Fonts so we avoid pulling in the `geist` package. JetBrains Mono is
 * the monospaced pair used in code blocks (SDK page snippets) — it
 * reads better than the system mono fallback at small sizes.
 */
const inter = Inter({
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  display: 'swap',
});

const mono = JetBrains_Mono({
  weight: ['400', '500'],
  subsets: ['latin'],
  display: 'swap',
});

/**
 * Vercel-inspired palette.
 *
 * Light mode: pure white surfaces with a subtle off-white for nested
 * sections, true-black text, and a hairline gray for borders. Vercel
 * uses borders (not shadows) to separate UI; cards get `1px solid`
 * instead of an `elevation` shadow. Brand blue stays as the primary
 * CTA color so VM-X identity persists.
 *
 * Dark mode: true black background, near-black surfaces, light gray
 * text. The `data` color-scheme selector pairs with the
 * `InitColorSchemeScript` in `layout.tsx` so the user's stored mode
 * survives a server rendering.
 */
const VMX_BLUE = '#0066ff';
const VMX_BLUE_DARK = '#3b82f6';

const lightPalette = {
  primary: { main: VMX_BLUE, contrastText: '#ffffff' },
  secondary: { main: '#171717' },
  success: { main: '#0bb96e' },
  warning: { main: '#f5a623' },
  error: { main: '#ee0000' },
  info: { main: VMX_BLUE },
  background: {
    default: '#ffffff',
    paper: '#ffffff',
  },
  text: {
    primary: '#000000',
    secondary: '#666666',
    disabled: '#a3a3a3',
  },
  divider: '#eaeaea',
  // Custom slot used by the AppBar — keeps the chrome flat & light in
  // light mode, mirroring Vercel's app shell.
  AppBar: {
    defaultBg: '#ffffff',
    darkBg: '#fafafa',
  },
};

const darkPalette = {
  primary: { main: VMX_BLUE_DARK, contrastText: '#ffffff' },
  secondary: { main: '#fafafa' },
  success: { main: '#0bb96e' },
  warning: { main: '#f5a623' },
  error: { main: '#ff4d4d' },
  info: { main: VMX_BLUE_DARK },
  background: {
    default: '#000000',
    paper: '#0a0a0a',
  },
  text: {
    primary: '#fafafa',
    secondary: '#a1a1a1',
    disabled: '#525252',
  },
  divider: '#262626',
  AppBar: {
    defaultBg: '#0a0a0a',
    darkBg: '#000000',
  },
};

const theme = createTheme({
  shape: { borderRadius: 6 },
  typography: {
    fontFamily: inter.style.fontFamily,
    // Vercel sets tight tracking on display text and uses semibold for
    // headings (rather than bold) which reads more refined.
    h1: { fontWeight: 600, letterSpacing: '-0.02em' },
    h2: { fontWeight: 600, letterSpacing: '-0.02em' },
    h3: { fontWeight: 600, letterSpacing: '-0.02em' },
    h4: { fontWeight: 600, letterSpacing: '-0.015em' },
    h5: { fontWeight: 600, letterSpacing: '-0.01em' },
    h6: { fontWeight: 600, letterSpacing: '-0.005em' },
    button: { fontWeight: 500, textTransform: 'none', letterSpacing: 0 },
    body1: { fontSize: '0.9375rem' },
    body2: { fontSize: '0.875rem' },
    caption: { fontSize: '0.75rem', letterSpacing: 0 },
  },
  colorSchemes: {
    light: { palette: lightPalette },
    dark: { palette: darkPalette },
  },
  cssVariables: {
    colorSchemeSelector: 'data',
  },
  defaultColorScheme: 'light',
  components: {
    // Hairline-bordered, shadow-free chrome — the Vercel signature.
    MuiCssBaseline: {
      styleOverrides: {
        html: {
          // Tabular numerics make audit timestamps + token counts
          // line up cleanly across rows.
          fontVariantNumeric: 'tabular-nums',
        },
        code: {
          fontFamily: mono.style.fontFamily,
        },
      },
    },
    MuiAppBar: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          borderBottom: '1px solid var(--mui-palette-divider)',
          backgroundImage: 'none',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          borderRight: '1px solid var(--mui-palette-divider)',
          backgroundImage: 'none',
        },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 500,
          paddingInline: 12,
        },
        sizeSmall: { paddingInline: 10 },
        outlined: {
          borderColor: 'var(--mui-palette-divider)',
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: { borderRadius: 6 },
      },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundImage: 'none',
        },
        outlined: {
          borderColor: 'var(--mui-palette-divider)',
        },
      },
    },
    MuiCard: {
      defaultProps: { variant: 'outlined', elevation: 0 },
      styleOverrides: {
        root: {
          borderColor: 'var(--mui-palette-divider)',
          backgroundImage: 'none',
        },
      },
    },
    MuiTextField: {
      defaultProps: { size: 'small', variant: 'outlined' },
    },
    MuiAutocomplete: {
      defaultProps: { size: 'small' },
      styleOverrides: {
        // The dropdown paper inherits the global `MuiPaper` defaults
        // (elevation 0, no border), so option lists float on the page
        // with no visible edge — the picker stops looking like a
        // surface and reads as raw items on the bg. Add a divider-
        // colored hairline + the standard shadow so the menu has a
        // clear boundary on both light and dark modes.
        paper: {
          border: '1px solid var(--mui-palette-divider)',
          boxShadow: 'var(--mui-shadows-4)',
        },
      },
    },
    MuiMenu: {
      styleOverrides: {
        // Same fix for the Select / Menu popovers — without the
        // border they read as floating text rather than a menu.
        paper: {
          border: '1px solid var(--mui-palette-divider)',
          boxShadow: 'var(--mui-shadows-4)',
        },
      },
    },
    MuiPopover: {
      styleOverrides: {
        // Catches popovers that don't go through MuiMenu (date
        // pickers, custom dropdowns) so they stay consistent.
        paper: {
          border: '1px solid var(--mui-palette-divider)',
          boxShadow: 'var(--mui-shadows-4)',
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        notchedOutline: {
          borderColor: 'var(--mui-palette-divider)',
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderColor: 'var(--mui-palette-divider)',
          fontSize: '0.875rem',
        },
        head: {
          fontWeight: 600,
          color: 'var(--mui-palette-text-secondary)',
          textTransform: 'none',
          letterSpacing: 0,
        },
      },
    },
    MuiDivider: {
      styleOverrides: {
        root: { borderColor: 'var(--mui-palette-divider)' },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: 'var(--mui-palette-text-primary)',
          color: 'var(--mui-palette-background-paper)',
          fontSize: '0.75rem',
          padding: '6px 10px',
        },
        // Without this, `<Tooltip arrow>` renders a default-gray arrow
        // against the inverted-bg tooltip body — visually mismatched.
        arrow: {
          color: 'var(--mui-palette-text-primary)',
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontWeight: 500,
          borderRadius: 6,
        },
        outlined: {
          borderColor: 'var(--mui-palette-divider)',
        },
      },
    },
    MuiAlert: {
      defaultProps: { variant: 'outlined' },
      styleOverrides: {
        root: {
          borderRadius: 6,
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 6,
          marginInline: 6,
          paddingInline: 10,
          '&.Mui-selected': {
            backgroundColor: 'var(--mui-palette-action-selected)',
          },
        },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 500,
          minHeight: 40,
        },
      },
    },
    MuiTabs: {
      styleOverrides: {
        indicator: { height: 2 },
      },
    },
  },
});

export default theme;
