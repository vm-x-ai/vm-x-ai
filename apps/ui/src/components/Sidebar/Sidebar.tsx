import Divider from '@mui/material/Divider';
import MuiDrawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import { CSSObject, styled, Theme, useTheme } from '@mui/material/styles';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import LightbulbIcon from '@mui/icons-material/Lightbulb';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import React from 'react';
import PersonIcon from '@mui/icons-material/Person';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import WorkspacesIcon from '@mui/icons-material/Workspaces';

export const DRAWER_WIDTH = 240;

const openedMixin = (theme: Theme): CSSObject => ({
  width: DRAWER_WIDTH,
  transition: theme.transitions.create('width', {
    easing: theme.transitions.easing.sharp,
    duration: theme.transitions.duration.enteringScreen,
  }),
  overflowX: 'hidden',
});

const closedMixin = (theme: Theme): CSSObject => ({
  transition: theme.transitions.create('width', {
    easing: theme.transitions.easing.sharp,
    duration: theme.transitions.duration.leavingScreen,
  }),
  overflowX: 'hidden',
  width: `calc(${theme.spacing(7)} + 1px)`,
  [theme.breakpoints.up('sm')]: {
    width: `calc(${theme.spacing(8)} + 1px)`,
  },
});

const Drawer = styled(MuiDrawer, {
  shouldForwardProp: (prop) => prop !== 'open',
})(({ theme }) => ({
  width: DRAWER_WIDTH,
  flexShrink: 0,
  whiteSpace: 'nowrap',
  boxSizing: 'border-box',
  variants: [
    {
      props: ({ open }) => open,
      style: {
        ...openedMixin(theme),
        '& .MuiDrawer-paper': openedMixin(theme),
      },
    },
    {
      props: ({ open }) => !open,
      style: {
        ...closedMixin(theme),
        '& .MuiDrawer-paper': closedMixin(theme),
      },
    },
  ],
}));

const DrawerHeader = styled('div')(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  padding: theme.spacing(0, 1),
  // necessary for content to be below app bar
  ...theme.mixins.toolbar,
}));

export type SidebarProps = {
  open: boolean;
  onClose: () => void;
};

type SidebarMenuItem = {
  type: 'menu';
  text: string;
  icon: React.ReactNode;
  href: string;
};

type SidebarMenuDivider = {
  type: 'divider';
  children?: React.ReactNode;
};

type SidebarMenu = SidebarMenuItem | SidebarMenuDivider;

const sidebarItems: SidebarMenu[] = [
  {
    type: 'menu',
    text: 'Getting Started',
    icon: <LightbulbIcon />,
    href: '/getting-started',
  },
  {
    type: 'menu',
    text: 'Workspaces',
    icon: <WorkspacesIcon />,
    href: '/workspaces',
  },
  {
    type: 'divider',
    children: <>Settings</>,
  },
  {
    type: 'menu',
    text: 'Roles',
    icon: <LockOpenIcon />,
    href: '/settings/roles',
  },
  {
    type: 'menu',
    text: 'User Management',
    icon: <PersonIcon />,
    href: '/settings/users',
  },
];

export default function Sidebar({ open, onClose }: SidebarProps) {
  const theme = useTheme();
  const pathname = usePathname();

  return (
    <Drawer variant="permanent" open={open}>
      <DrawerHeader>
        <IconButton onClick={onClose}>
          {theme.direction === 'rtl' ? (
            <ChevronRightIcon />
          ) : (
            <ChevronLeftIcon />
          )}
        </IconButton>
      </DrawerHeader>
      <Divider />
      <List>
        {sidebarItems.map((item, index) => (
          <React.Fragment key={index}>
            {item.type === 'divider' && (
              <Divider sx={{ marginTop: 1, marginBottom: 1 }}>
                {open && item.children}
              </Divider>
            )}
            {item.type === 'menu' && (
              <ListItem
                key={item.text}
                disablePadding
                sx={{ display: 'block' }}
              >
                <ListItemButton
                  LinkComponent={Link}
                  selected={pathname?.startsWith(item.href)}
                  href={item.href}
                  sx={[
                    {
                      minHeight: 48,
                      px: 2.5,
                    },
                    open
                      ? {
                          justifyContent: 'initial',
                        }
                      : {
                          justifyContent: 'center',
                        },
                  ]}
                >
                  <ListItemIcon
                    sx={[
                      {
                        minWidth: 0,
                        justifyContent: 'center',
                      },
                      open
                        ? {
                            mr: 3,
                          }
                        : {
                            mr: 'auto',
                          },
                    ]}
                  >
                    {item.icon}
                  </ListItemIcon>
                  <ListItemText
                    primary={item.text}
                    sx={[
                      open
                        ? {
                            opacity: 1,
                          }
                        : {
                            opacity: 0,
                          },
                    ]}
                  />
                </ListItemButton>
              </ListItem>
            )}
          </React.Fragment>
        ))}
      </List>
    </Drawer>
  );
}
