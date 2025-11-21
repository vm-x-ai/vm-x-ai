'use client';

import { WorkspaceEntity } from '@/clients/api';
import AddIcon from '@mui/icons-material/Add';
import SettingsIcon from '@mui/icons-material/Settings';
import WorkspacesIcon from '@mui/icons-material/Workspaces';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { useTheme } from '@mui/material/styles';
import Tooltip from '@mui/material/Tooltip';
import useMediaQuery from '@mui/material/useMediaQuery';
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
  const pathname = usePathname();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const selectedWorkspaceIndex = workspaces.findIndex((workspace) =>
    pathname?.startsWith(`/${workspace.workspaceId}`)
  );
  const selectedWorkspace = workspaces[selectedWorkspaceIndex];
  const selectedEnvironmentIndex = selectedWorkspace?.environments?.findIndex(
    (environment) =>
      pathname?.startsWith(
        `/${selectedWorkspace?.workspaceId}/${environment.environmentId}`
      )
  );
  const selectedEnvironment =
    selectedWorkspace?.environments?.[selectedEnvironmentIndex ?? -1];
  const currentTab =
    selectedEnvironment && selectedWorkspace
      ? pathname
          ?.replace(
            `/${selectedWorkspace.workspaceId}/${selectedEnvironment.environmentId}/`,
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
    const value =
      selectedWorkspace && selectedEnvironment
        ? `${selectedWorkspace.name} - ${selectedEnvironment.name}`
        : 'Please select a workspace';

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
        sx={{ bgcolor: 'var(--mui-palette-AppBar-darkBg)' }}
      >
        <ListItemButton
          id="workspace-button"
          aria-haspopup="listbox"
          aria-controls="workspace-menu"
          aria-label="Workspace"
          aria-expanded={open ? 'true' : undefined}
          onClick={handleClickListItem}
        >
          <ListItemText primary={buttonText} />
        </ListItemButton>
      </List>
      <Menu
        id="workspace-menu"
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        MenuListProps={{
          'aria-labelledby': 'workspace-button',
          role: 'listbox',
        }}
      >
        {workspaces.map((workspace, workspaceIndex) => [
          <MenuItem
            selected={workspaceIndex === selectedWorkspaceIndex}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
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
              <Tooltip title="Settings">
                <IconButton
                  size="small"
                  LinkComponent={Link}
                  href={`/${workspace.workspaceId}/settings`}
                  sx={{
                    padding: 0,
                    marginRight: 'auto',
                  }}
                >
                  <SettingsIcon fontSize="small" />
                </IconButton>
              </Tooltip>
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
              href={`/${workspace.workspaceId}/${environment.environmentId}/${
                currentTab ? currentTab : 'ai-connections/overview'
              }`}
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
