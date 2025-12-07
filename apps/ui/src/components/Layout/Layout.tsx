'use client';

import { Menu as MenuIcon } from '@mui/icons-material';
import MuiAppBar, { AppBarProps as MuiAppBarProps } from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import Link from 'next/link';
import { Suspense } from 'react';
import AccountMenu from './AccountMenu';
import HeaderLogo from './Logo';
import WorkspaceSelector from '../Workspace/WorkspaceSelector';
import { useSession } from 'next-auth/react';
import { styled } from '@mui/material/styles';
import Sidebar, { DRAWER_WIDTH } from '../Sidebar/Sidebar';
import { useAppStore } from '@/store/provider';
import { usePathname } from 'next/navigation';

interface AppBarProps extends MuiAppBarProps {
  open?: boolean;
}

const AppBar = styled(MuiAppBar, {
  shouldForwardProp: (prop) => prop !== 'open',
})<AppBarProps>(({ theme }) => ({
  zIndex: theme.zIndex.drawer + 1,
  transition: theme.transitions.create(['width', 'margin'], {
    easing: theme.transitions.easing.sharp,
    duration: theme.transitions.duration.leavingScreen,
  }),
  variants: [
    {
      props: ({ open }) => open,
      style: {
        marginLeft: DRAWER_WIDTH,
        width: `calc(100% - ${DRAWER_WIDTH}px)`,
        transition: theme.transitions.create(['width', 'margin'], {
          easing: theme.transitions.easing.sharp,
          duration: theme.transitions.duration.enteringScreen,
        }),
      },
    },
  ],
}));

export type LayoutProps = {
  children: React.ReactNode;
};

export default function Layout({ children }: LayoutProps) {
  const { data: authSession } = useSession();
  const open = useAppStore((state) => state.sidebar.open);
  const setOpen = useAppStore((state) => state.setSidebarOpen);
  const pathname = usePathname();

  return (
    <Box sx={{ display: 'flex' }}>
      <AppBar
        position="fixed"
        color="transparent"
        sx={{
          backgroundColor: 'var(--mui-palette-background-paper)',
          boxShadow: 'var(--mui-shadows-2)',
        }}
        open={open}
      >
        <Toolbar>
          <IconButton
            color="inherit"
            aria-label="open drawer"
            onClick={() => setOpen(true)}
            edge="start"
            sx={[
              {
                marginRight: 5,
              },
              open && { display: 'none' },
            ]}
          >
            <MenuIcon />
          </IconButton>
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
                {pathname?.startsWith('/workspaces') && (
                  <Suspense fallback={<div>Loading workspaces...</div>}>
                    <WorkspaceSelector />
                  </Suspense>
                )}
                <AccountMenu user={authSession?.user} />
              </Box>
            </Box>
          )}
        </Toolbar>
      </AppBar>
      <Sidebar open={open} onClose={() => setOpen(false)} />
      <Box component="main" sx={{ flexGrow: 1, p: 3 }}>
        {children}
      </Box>
    </Box>
  );
}
