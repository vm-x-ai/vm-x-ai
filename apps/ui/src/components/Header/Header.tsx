'use client';

import { Menu as MenuIcon } from '@mui/icons-material';
import MuiAppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import Link from 'next/link';
import { Suspense } from 'react';
import AccountMenu from './AccountMenu';
import HeaderLogo from './Logo';
import WorkspaceSelector from './Workspace/WorkspaceSelector';
import { useSession } from 'next-auth/react';

export default function Header() {
  const { data: authSession } = useSession();

  return (
    <>
      <MuiAppBar
        position="fixed"
        color="transparent"
        sx={{
          backgroundColor: 'var(--mui-palette-background-paper)',
          boxShadow: 'var(--mui-shadows-2)',
        }}
      >
        <Toolbar>
          <IconButton
            color="inherit"
            aria-label="open drawer"
            edge="start"
            sx={{ mr: 2, ...{ display: 'none' } }}
          >
            <MenuIcon />
          </IconButton>
          <Typography
            variant="h6"
            color="primary"
            noWrap
            component={Link}
            href="/"
          >
            <HeaderLogo />
          </Typography>
          {authSession && (
            <Box sx={{ marginLeft: 'auto' }}>
              <Box display="flex" gap="1rem">
                <Suspense fallback={<div>Loading workspaces...</div>}>
                  <WorkspaceSelector />
                </Suspense>
                <AccountMenu user={authSession?.user} />
              </Box>
            </Box>
          )}
        </Toolbar>
      </MuiAppBar>
    </>
  );
}
