'use client';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Link from 'next/link';
import React from 'react';

export type EmptyStateProps = {
  /** Big illustrative icon — pass an MUI icon component already styled. */
  icon?: React.ReactNode;
  /** Bold heading line. */
  title: string;
  /** One-line explanation under the heading. */
  description?: React.ReactNode;
  /**
   * Primary action. Accepts either an `href` (renders an anchor via
   * `next/link`) or an `onClick` (renders a button). Both are
   * optional — pass `null`/omit when the empty state is informational.
   */
  ctaLabel?: string;
  ctaHref?: string;
  ctaOnClick?: () => void;
  ctaIcon?: React.ReactNode;
  /** Secondary action row (e.g. doc link). */
  secondary?: React.ReactNode;
  /** Override the elevation of the wrapping Paper. */
  elevation?: number;
};

/**
 * Reusable empty-state surface used on overview/list pages and the
 * playground when nothing has been created yet. Centring + generous
 * vertical padding gives a "completed feel" instead of a blank
 * column-header table.
 *
 * Why a single component: every empty page used to render either
 * literally nothing (table with header only) or a one-line "no rows"
 * message — neither communicates *what to do next*. A consistent
 * empty-state lets every page nudge users toward the right primary
 * action without per-page reinvention.
 */
export default function EmptyState({
  icon,
  title,
  description,
  ctaLabel,
  ctaHref,
  ctaOnClick,
  ctaIcon,
  secondary,
  elevation = 0,
}: EmptyStateProps) {
  const hasCta = !!ctaLabel && (!!ctaHref || !!ctaOnClick);
  return (
    <Paper
      variant={elevation === 0 ? 'outlined' : 'elevation'}
      elevation={elevation}
      sx={{
        py: 8,
        px: 4,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 2,
        textAlign: 'center',
        backgroundColor: 'background.paper',
      }}
    >
      {icon && (
        <Box sx={{ color: 'primary.main', '& svg': { fontSize: 64 } }}>
          {icon}
        </Box>
      )}
      <Typography variant="h6" component="h2">
        {title}
      </Typography>
      {description && (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ maxWidth: 480 }}
        >
          {description}
        </Typography>
      )}
      {hasCta && (
        <Box sx={{ display: 'flex', gap: 1 }}>
          {ctaHref ? (
            <Button
              component={Link}
              href={ctaHref}
              variant="contained"
              startIcon={ctaIcon}
            >
              {ctaLabel}
            </Button>
          ) : (
            <Button
              variant="contained"
              startIcon={ctaIcon}
              onClick={ctaOnClick}
            >
              {ctaLabel}
            </Button>
          )}
        </Box>
      )}
      {secondary}
    </Paper>
  );
}
