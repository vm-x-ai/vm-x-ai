'use client';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import Link from 'next/link';
import AppContainer from '@/components/Layout/Container';

export type AIResourceTabsProps = {
  workspaceId: string;
  environmentId: string;
  resourceId: string;
  children: React.ReactNode;
};

/**
 * Resource-edit shell. The previous left-rail SubTabs (General /
 * Routing / Multi-Answer / Fallback / Capacity) have moved into the
 * main sidebar — when the user is on `/ai-resources/edit/[id]/*` the
 * sidebar's `AI Resources` group expands with those tabs nested
 * underneath. Removing the rail here gives the form the full content
 * width.
 *
 * `'use client'` is required even though no hooks run here: MUI's
 * `Button` + `component={Link}` + icon props (`<OpenInNewIcon />`)
 * are function references / class component references that cannot
 * cross the server→client RSC boundary as serialised props. Removing
 * the directive triggers a console.error per render (and Next's
 * source-map stack parser eats the event loop under e2e load).
 */
export default function AIResourceTabs({
  workspaceId,
  environmentId,
  resourceId,
  children,
}: AIResourceTabsProps) {
  return (
    <AppContainer>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
        <Button
          component={Link}
          href={`/workspaces/${workspaceId}/${environmentId}/playground?resourceId=${resourceId}`}
          endIcon={<OpenInNewIcon />}
          variant="outlined"
          size="small"
        >
          Open playground
        </Button>
      </Box>
      {children}
    </AppContainer>
  );
}
