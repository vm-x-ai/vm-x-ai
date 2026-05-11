'use client';

import { EnvironmentEntity, WorkspaceEntity } from '@/clients/api';
import Box from '@mui/material/Box';
import Breadcrumbs from '@/components/Layout/Breadcrumbs';

/**
 * Workspace-scoped layout shell. Historically rendered a horizontal
 * tab strip (AI Connections / AI Resources / Insights / …) at the top
 * of every workspace page; that responsibility moved to the sidebar
 * submenu in `Sidebar.tsx`. The component now owns just the
 * breadcrumb header so child pages stay laid out the same way.
 *
 * The `tabs` prop is preserved (and ignored) so the existing layout
 * file can pass its tab definitions without rework — useful if/when
 * we want a secondary surface (e.g. mobile bottom-nav) reading from
 * the same source.
 */
type LayoutProps = {
  children: React.ReactNode;
  tabs?: unknown;
  workspace: WorkspaceEntity;
  environment: EnvironmentEntity;
};

export default function WorkspaceTabs({
  children,
  workspace,
  environment,
}: LayoutProps) {
  return (
    <Box sx={{ marginTop: 1 }}>
      <Box
        sx={(theme) => ({
          // Stick under the fixed AppBar (Toolbar height = 64 on desktop).
          // The wrapping page layout adds `mt-18` (72px) of top margin so
          // 64px lines the breadcrumb up flush with the AppBar's bottom.
          //
          // Use the body's bg token instead of `background.default` so the
          // strip blends with the page chrome — the document body uses
          // `AppBar.darkBg` (off-white #fafafa in light mode, #000 in
          // dark), so painting the sticky strip with the same token avoids
          // the visible white band that `background.default` produced.
          position: 'sticky',
          top: 64,
          zIndex: theme.zIndex.appBar - 1,
          bgcolor:
            'var(--mui-palette-AppBar-darkBg, var(--mui-palette-AppBar-defaultBg))',
          paddingY: 1,
          marginBottom: 2,
        })}
      >
        <Breadcrumbs workspace={workspace} environment={environment} />
      </Box>
      {children}
    </Box>
  );
}
