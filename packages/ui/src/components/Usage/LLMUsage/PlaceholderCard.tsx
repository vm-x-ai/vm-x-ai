import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import React from 'react';

export type PlaceholderCardProps = {
  title: string;
  description: React.ReactNode;
  /** Short list of what would need to be implemented to ship the chart. */
  needs?: string[];
};

/**
 * Inline placeholder for usage charts that need backend work before
 * they can render real data (fallback events, routing decisions,
 * concurrency, baseline cost-savings). Keeps the slot reserved on the
 * Usage page so the layout doesn't shift when the real chart lands;
 * tells viewers what to expect.
 */
export function PlaceholderCard({
  title,
  description,
  needs,
}: PlaceholderCardProps) {
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
        {title}
      </Typography>
      <Box sx={{ mt: 1.5 }}>
        <Alert severity="info" variant="outlined">
          <AlertTitle>Coming soon</AlertTitle>
          <Typography variant="body2" sx={{ mb: needs ? 1 : 0 }}>
            {description}
          </Typography>
          {needs && needs.length > 0 && (
            <Box component="ul" sx={{ mt: 0.5, mb: 0, pl: 2 }}>
              {needs.map((n, i) => (
                <li key={i}>
                  <Typography variant="body2">{n}</Typography>
                </li>
              ))}
            </Box>
          )}
        </Alert>
      </Box>
    </Paper>
  );
}
