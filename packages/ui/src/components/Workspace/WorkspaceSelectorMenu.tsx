'use client';

import { WorkspaceEntity } from '@/clients/api';
import AddIcon from '@mui/icons-material/Add';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import WorkspacesIcon from '@mui/icons-material/Workspaces';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useResolvedColorScheme } from '@/hooks/use-resolved-color-scheme';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import React, { useMemo } from 'react';
import { useState } from 'react';
import StorageIcon from '@mui/icons-material/Storage';

export type WorkspaceSelectorMenuProps = {
  workspaces: WorkspaceEntity[];
};

export default function WorkspaceSelectorMenu({
  workspaces,
}: WorkspaceSelectorMenuProps) {
  const theme = useTheme();
  const isSm = useMediaQuery(theme.breakpoints.up('sm'));
  // `theme.palette.mode` is pinned at the default scheme when MUI is
  // configured with `cssVariables` + `colorSchemes` — the actual scheme
  // lives on the `data-mui-color-scheme` attribute. Resolve it through
  // `useColorScheme` so dark-mode-only overrides actually apply.
  const isDark = useResolvedColorScheme() === 'dark';
  const pathname = usePathname();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  // Anchor the prefix matches with a trailing `/` so IDs that share a
  // common prefix (e.g. `prod` vs `production`) don't accidentally
  // both claim the same path. The trailing slash lets us still match
  // `/workspaces/<id>/edit`, `/workspaces/<id>/<eid>`, etc.
  const selectedWorkspaceIndex = workspaces.findIndex((workspace) =>
    pathname?.startsWith(`/workspaces/${workspace.workspaceId}/`)
  );
  const selectedWorkspace = workspaces[selectedWorkspaceIndex];
  const selectedEnvironmentIndex = selectedWorkspace?.environments?.findIndex(
    (environment) =>
      pathname?.startsWith(
        `/workspaces/${selectedWorkspace?.workspaceId}/${environment.environmentId}/`
      )
  );
  const selectedEnvironment =
    selectedWorkspace?.environments?.[selectedEnvironmentIndex ?? -1];
  const currentTab =
    selectedEnvironment && selectedWorkspace
      ? pathname
          ?.replace(
            `/workspaces/${selectedWorkspace.workspaceId}/${selectedEnvironment.environmentId}/`,
            ''
          )
          .split('/')[0]
      : undefined;

  const open = Boolean(anchorEl);

  const handleClickListItem = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const buttonText = useMemo(() => {
    let value: string;
    if (selectedWorkspace && selectedEnvironment) {
      value = `${selectedWorkspace.name} - ${selectedEnvironment.name}`;
    } else if (selectedWorkspace) {
      // URL is inside a workspace but not yet under an environment
      // (e.g. `/workspaces/:id/edit`). Show the workspace name alone
      // so the selector reflects the actual context instead of
      // misleadingly asking the user to pick a workspace.
      value = selectedWorkspace.name;
    } else {
      value = 'Please select a workspace';
    }

    if (isSm) {
      return value;
    }

    return value.length > 20 ? `${value.slice(0, 20)}...` : value;
  }, [isSm, selectedEnvironment, selectedWorkspace]);

  return (
    <div>
      <List
        component="nav"
        aria-label="Workspaces"
        sx={{ bgcolor: 'var(--mui-palette-AppBar-darkBg)', py: 0.5 }}
      >
        <ListItemButton
          id="workspace-button"
          aria-haspopup="listbox"
          aria-controls="workspace-menu"
          aria-label="Workspace"
          aria-expanded={open ? 'true' : undefined}
          onClick={handleClickListItem}
          sx={{
            // Without affordances the trigger reads as a label.
            // A hairline border + chevron + hover background make
            // it look like an interactive picker (matches Vercel /
            // Linear-style scope switchers).
            //
            // Use the raw CSS variables (not `theme.palette.*`) — in an
            // `sx` callback those resolve to the *default* scheme's
            // literal hex (light → #eaeaea), which reads as a bright
            // hairline against the dark sidebar. The CSS-variable form
            // is rebound by `data-mui-color-scheme`, so the divider
            // tracks the active scheme correctly.
            border: '1px solid var(--mui-palette-divider)',
            borderRadius: 1,
            '&:hover': {
              backgroundColor: 'var(--mui-palette-action-hover)',
              borderColor: 'var(--mui-palette-text-secondary)',
            },
            ...(open && {
              backgroundColor: 'var(--mui-palette-action-selected)',
              borderColor: 'var(--mui-palette-text-secondary)',
            }),
          }}
        >
          <ListItemText
            primary={buttonText}
            slotProps={{
              primary: {
                noWrap: true,
                sx: { fontWeight: 500 },
              },
            }}
          />
          {open ? (
            <KeyboardArrowUpIcon fontSize="small" />
          ) : (
            <KeyboardArrowDownIcon fontSize="small" />
          )}
        </ListItemButton>
      </List>
      <Menu
        id="workspace-menu"
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        slotProps={{
          list: {
            'aria-labelledby': 'workspace-button',
            role: 'listbox',
          },
          paper: {
            sx: (theme) => ({
              // In dark mode the default `background.paper` (#0a0a0a)
              // sits flush with the sidebar's `AppBar-darkBg` (#000) and
              // visually merges into the same surface — the dropdown
              // stops reading as a separate dialog. Lift it onto a
              // clearly-elevated surface and outline it with a dark
              // border so the seam between the menu (#171717) and the
              // sidebar (#000) reads as a deliberate edge instead of a
              // bright hairline. Paper applies an elevation gradient in
              // dark mode (`backgroundImage: linear-gradient(...)`) on
              // top of `bgcolor`, which makes the menu lighter than the
              // override; force it off so `#171717` actually wins.
              boxShadow: theme.shadows[8],
              ...(isDark
                ? {
                    border: '1px solid rgba(0, 0, 0, 0.6)',
                    bgcolor: '#171717',
                    backgroundImage: 'none',
                  }
                : {
                    border: `1px solid ${theme.palette.divider}`,
                  }),
            }),
          },
        }}
      >
        {workspaces.map((workspace, workspaceIndex) => [
          <MenuItem
            selected={workspaceIndex === selectedWorkspaceIndex}
            component={Link}
            href={`/workspaces/${workspace.workspaceId}`}
            key={workspace.workspaceId}
          >
            <Box
              sx={{
                display: 'flex',
                width: '100%',
              }}
            >
              <ListItemIcon>
                <WorkspacesIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>{workspace.name}</ListItemText>
            </Box>
          </MenuItem>,
          ...(workspace.environments?.map((environment, envIndex) => (
            <MenuItem
              key={environment.environmentId}
              component={Link}
              selected={
                workspaceIndex === selectedWorkspaceIndex &&
                envIndex === selectedEnvironmentIndex
              }
              href={`/workspaces/${workspace.workspaceId}/${
                environment.environmentId
              }/${currentTab ? currentTab : 'ai-connections/overview'}`}
              sx={{
                marginLeft: '1rem',
              }}
            >
              <ListItemIcon>
                <StorageIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>{environment.name}</ListItemText>
            </MenuItem>
          )) ?? []),
          <MenuItem
            key={`create-new-environment-${workspace.workspaceId}`}
            component={Link}
            href={{
              pathname: `/getting-started`,
              query: {
                workspaceId: workspace.workspaceId,
              },
            }}
            sx={{
              marginLeft: '1rem',
            }}
          >
            <ListItemIcon>
              <AddIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Create new environment</ListItemText>
          </MenuItem>,
        ])}

        <Divider />
        <MenuItem component={Link} href="/getting-started">
          <ListItemIcon>
            <AddIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Create new workspace</ListItemText>
        </MenuItem>
      </Menu>
    </div>
  );
}
