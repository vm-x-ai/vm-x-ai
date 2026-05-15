'use client';

import Collapse from '@mui/material/Collapse';
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
import React, { Suspense } from 'react';
import PersonIcon from '@mui/icons-material/Person';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import WorkspacesIcon from '@mui/icons-material/Workspaces';
import AttachMoneyIcon from '@mui/icons-material/AttachMoney';
import ElectricalServicesIcon from '@mui/icons-material/ElectricalServices';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import LowPriorityIcon from '@mui/icons-material/LowPriority';
import SecurityIcon from '@mui/icons-material/Security';
import LineAxisIcon from '@mui/icons-material/LineAxis';
import CodeIcon from '@mui/icons-material/Code';
import PlayCircleOutlinedIcon from '@mui/icons-material/PlayCircleOutlined';
import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined';
import BarChartOutlinedIcon from '@mui/icons-material/BarChartOutlined';
import TuneIcon from '@mui/icons-material/Tune';
import CallSplitIcon from '@mui/icons-material/CallSplit';
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted';
import ReplayIcon from '@mui/icons-material/Replay';
import SpeedIcon from '@mui/icons-material/Speed';
import DataObjectIcon from '@mui/icons-material/DataObject';
import HubIcon from '@mui/icons-material/Hub';
import WorkspaceSelector from '../Workspace/WorkspaceSelector';

export const DRAWER_WIDTH = 260;

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
  ...theme.mixins.toolbar,
}));

export type SidebarProps = {
  open: boolean;
  onClose: () => void;
};

type SidebarSubItem = {
  text: string;
  icon: React.ReactNode;
  /** Path the link points to. */
  href: string;
  /** Optional broader prefix used to highlight the parent group as active. */
  matchPrefix?: string;
  /**
   * Nested children rendered as a deeper-indented collapsible group
   * when the parent is the active route. Used to lift sub-tabs that
   * lived in a SubTabs left rail (e.g. Insights → Audit / Usage) into
   * the sidebar so the page body keeps its full width.
   */
  subItems?: Array<{
    text: string;
    icon: React.ReactNode;
    href: string;
    matchPrefix?: string;
  }>;
  /**
   * When true, the nested sub-items render even if the parent group
   * isn't the active route. Use it for short, always-relevant
   * children (e.g. Insights → Audit / Usage) so the user can jump
   * straight to a sub-page without first clicking the parent. Long
   * conditional menus (AI Resources sub-tabs, which only mean
   * something while editing a specific resource) leave it false.
   */
  expandAlways?: boolean;
};

/**
 * Build the workspace-scoped submenu when the user is on a workspace
 * route. Returns null when the URL has no `(workspaceId, environmentId)`
 * pair (e.g. on /getting-started, /settings/*, /).
 *
 * The entries mirror the legacy `WorkspaceTabs` strip — same names, same
 * targets — but rendered as a collapsible group inside the sidebar.
 */
function useWorkspaceSubItems(): SidebarSubItem[] | null {
  const pathname = usePathname();
  // Memoise over `pathname` so the items array (and the JSX icons it
  // contains) stays referentially stable across re-renders triggered
  // by sibling state changes — otherwise every parent render rebuilds
  // the list and pushes a new identity through every nested
  // ListItemButton.
  return React.useMemo(() => buildWorkspaceSubItems(pathname), [pathname]);
}

function buildWorkspaceSubItems(
  pathname: string | null
): SidebarSubItem[] | null {
  if (!pathname?.startsWith('/workspaces/')) return null;
  const segments = pathname.split('/').filter(Boolean);
  // /workspaces/<wid>/<eid>/...   →  segments = ['workspaces', wid, eid, ...]
  if (segments.length < 3 || segments[2] === 'edit') return null;
  const wid = segments[1];
  const eid = segments[2];
  const base = `/workspaces/${wid}/${eid}`;

  // AI Connection edit pages also have a sub-tab strip
  // (General Settings / Provider / Capacity). Same pattern as the
  // AI Resources block below — only expose them while editing.
  const aiConnectionEditMatch = pathname.match(
    /\/ai-connections\/edit\/([^/]+)/
  );
  const editingConnectionId = aiConnectionEditMatch?.[1];
  const aiConnectionSubItems = editingConnectionId
    ? [
        {
          text: 'General Settings',
          icon: <TuneIcon />,
          href: `${base}/ai-connections/edit/${editingConnectionId}/general`,
        },
        {
          text: 'Provider',
          icon: <HubIcon />,
          href: `${base}/ai-connections/edit/${editingConnectionId}/provider`,
        },
        {
          text: 'Capacity',
          icon: <SpeedIcon />,
          href: `${base}/ai-connections/edit/${editingConnectionId}/capacity`,
        },
      ]
    : undefined;

  // AI Resources edit pages have their own sub-tab strip
  // (General Settings / Dynamic Routing / Multi-Answer / Fallback /
  // Capacity). When the user is on an edit page, lift those tabs into
  // the sidebar so the page body doesn't host a redundant left rail.
  // Outside the edit flow we leave AI Resources as a plain leaf.
  // `[^/]+` already terminates at the next slash; using `\b` here
  // misbehaves for IDs ending in characters that aren't a word
  // boundary (e.g. trailing dashes on autogenerated IDs).
  const aiResourceEditMatch = pathname.match(/\/ai-resources\/edit\/([^/]+)/);
  const editingResourceId = aiResourceEditMatch?.[1];
  const aiResourceSubItems = editingResourceId
    ? [
        {
          text: 'General Settings',
          icon: <TuneIcon />,
          href: `${base}/ai-resources/edit/${editingResourceId}/general`,
        },
        {
          text: 'Dynamic Routing',
          icon: <CallSplitIcon />,
          href: `${base}/ai-resources/edit/${editingResourceId}/routing`,
        },
        {
          text: 'Multi-Answer',
          icon: <FormatListBulletedIcon />,
          href: `${base}/ai-resources/edit/${editingResourceId}/multi-answer`,
        },
        {
          text: 'Fallback',
          icon: <ReplayIcon />,
          href: `${base}/ai-resources/edit/${editingResourceId}/fallback`,
        },
        {
          text: 'Capacity',
          icon: <SpeedIcon />,
          href: `${base}/ai-resources/edit/${editingResourceId}/capacity`,
        },
        {
          text: 'Advanced (JSON)',
          icon: <DataObjectIcon />,
          href: `${base}/ai-resources/edit/${editingResourceId}/advanced`,
        },
      ]
    : undefined;

  return [
    {
      text: 'Playground',
      icon: <PlayCircleOutlinedIcon />,
      href: `${base}/playground`,
    },
    {
      text: 'AI Connections',
      icon: <ElectricalServicesIcon />,
      href: `${base}/ai-connections/overview`,
      matchPrefix: `${base}/ai-connections`,
      ...(aiConnectionSubItems ? { subItems: aiConnectionSubItems } : {}),
    },
    {
      text: 'AI Resources',
      icon: <SmartToyIcon />,
      href: `${base}/ai-resources/overview`,
      matchPrefix: `${base}/ai-resources`,
      ...(aiResourceSubItems ? { subItems: aiResourceSubItems } : {}),
    },
    {
      text: 'Prioritization',
      icon: <LowPriorityIcon />,
      href: `${base}/prioritization`,
    },
    {
      text: 'Security',
      icon: <SecurityIcon />,
      href: `${base}/security/auth/role/overview`,
      matchPrefix: `${base}/security`,
      expandAlways: true,
      subItems: [
        {
          text: 'Roles',
          icon: <LockOpenIcon />,
          href: `${base}/security/auth/role/overview`,
          matchPrefix: `${base}/security/auth/role`,
        },
      ],
    },
    {
      text: 'Insights',
      icon: <LineAxisIcon />,
      href: `${base}/insights/audit`,
      matchPrefix: `${base}/insights`,
      // Always expand — Audit / Usage are short labels that should
      // be reachable in one click from any workspace page.
      expandAlways: true,
      subItems: [
        {
          text: 'Audit',
          icon: <FactCheckOutlinedIcon />,
          href: `${base}/insights/audit`,
        },
        {
          text: 'Usage',
          icon: <BarChartOutlinedIcon />,
          href: `${base}/insights/usage`,
        },
      ],
    },
    {
      text: 'SDK',
      icon: <CodeIcon />,
      href: `${base}/sdk`,
    },
  ];
}

export default function Sidebar({ open, onClose }: SidebarProps) {
  const theme = useTheme();
  const pathname = usePathname();
  const workspaceItems = useWorkspaceSubItems();
  // Auto-expand the Workspace group when the user enters a workspace
  // route. Depends on a stable boolean (not the freshly-built array
  // returned by the hook on every render) so the user's manual
  // collapse decision survives subsequent re-renders.
  const inWorkspace = workspaceItems != null;
  const [workspaceGroupOpen, setWorkspaceGroupOpen] =
    React.useState<boolean>(inWorkspace);
  React.useEffect(() => {
    if (inWorkspace) setWorkspaceGroupOpen(true);
  }, [inWorkspace]);

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
      {/* Workspace + Environment switcher, lifted from the AppBar so the
          AppBar gets to focus on logo + actions while the sidebar owns
          the navigation context. Hidden when the sidebar is collapsed
          to avoid awkward truncation in the rail width. */}
      {open && (
        <Suspense fallback={null}>
          <WorkspaceSelector />
        </Suspense>
      )}
      <Divider />
      <List>
        <ListItem disablePadding sx={{ display: 'block' }}>
          <ListItemButton
            LinkComponent={Link}
            selected={pathname === '/getting-started'}
            href="/getting-started"
            sx={[
              { minHeight: 48, px: 2.5 },
              open
                ? { justifyContent: 'initial' }
                : { justifyContent: 'center' },
            ]}
          >
            <ListItemIcon
              sx={[
                { minWidth: 0, justifyContent: 'center' },
                open ? { mr: 3 } : { mr: 'auto' },
              ]}
            >
              <LightbulbIcon />
            </ListItemIcon>
            <ListItemText
              primary="Getting Started"
              sx={[open ? { opacity: 1 } : { opacity: 0 }]}
            />
          </ListItemButton>
        </ListItem>

        {/* Workspaces parent + collapsible submenu (only renders the
            submenu when we have a (wid, eid) context). When inside a
            workspace, clicking the parent expands/collapses the group;
            outside, it links to the workspaces overview. */}
        <ListItem disablePadding sx={{ display: 'block' }}>
          {workspaceItems ? (
            <ListItemButton
              onClick={() => setWorkspaceGroupOpen((v) => !v)}
              sx={[
                { minHeight: 48, px: 2.5 },
                open
                  ? { justifyContent: 'initial' }
                  : { justifyContent: 'center' },
              ]}
            >
              <ListItemIcon
                sx={[
                  { minWidth: 0, justifyContent: 'center' },
                  open ? { mr: 3 } : { mr: 'auto' },
                ]}
              >
                <WorkspacesIcon />
              </ListItemIcon>
              <ListItemText
                primary="Workspaces"
                sx={[open ? { opacity: 1 } : { opacity: 0 }]}
              />
              {open && (workspaceGroupOpen ? <ExpandLess /> : <ExpandMore />)}
            </ListItemButton>
          ) : (
            <ListItemButton
              LinkComponent={Link}
              href="/workspaces"
              selected={!!pathname?.startsWith('/workspaces')}
              sx={[
                { minHeight: 48, px: 2.5 },
                open
                  ? { justifyContent: 'initial' }
                  : { justifyContent: 'center' },
              ]}
            >
              <ListItemIcon
                sx={[
                  { minWidth: 0, justifyContent: 'center' },
                  open ? { mr: 3 } : { mr: 'auto' },
                ]}
              >
                <WorkspacesIcon />
              </ListItemIcon>
              <ListItemText
                primary="Workspaces"
                sx={[open ? { opacity: 1 } : { opacity: 0 }]}
              />
            </ListItemButton>
          )}
        </ListItem>
        {workspaceItems && (
          <Collapse
            in={workspaceGroupOpen && open}
            timeout="auto"
            unmountOnExit
          >
            <List component="div" disablePadding>
              {workspaceItems.map((item) => {
                const active = item.matchPrefix
                  ? pathname?.startsWith(item.matchPrefix)
                  : pathname?.startsWith(item.href);
                return (
                  <React.Fragment key={item.text}>
                    <ListItemButton
                      LinkComponent={Link}
                      href={item.href}
                      selected={!!active}
                      sx={{ pl: 4, minHeight: 40 }}
                    >
                      <ListItemIcon sx={{ minWidth: 0, mr: 2 }}>
                        {item.icon}
                      </ListItemIcon>
                      <ListItemText primary={item.text} />
                    </ListItemButton>
                    {/* Nested sub-items render when the parent is
                        the active group — keeps the rail compact
                        when the user isn't in that section. Items
                        that opt into `expandAlways` (e.g. Insights)
                        keep their submenu visible everywhere so the
                        user can jump to a sub-page in one click. */}
                    {item.subItems && (active || item.expandAlways) && (
                      <List component="div" disablePadding>
                        {item.subItems.map((sub) => {
                          const subActive = sub.matchPrefix
                            ? pathname?.startsWith(sub.matchPrefix)
                            : pathname?.startsWith(sub.href);
                          return (
                            <ListItemButton
                              key={sub.text}
                              LinkComponent={Link}
                              href={sub.href}
                              selected={!!subActive}
                              sx={{ pl: 7, minHeight: 36 }}
                            >
                              <ListItemIcon sx={{ minWidth: 0, mr: 2 }}>
                                {sub.icon}
                              </ListItemIcon>
                              <ListItemText
                                primary={sub.text}
                                slotProps={{
                                  primary: { variant: 'body2' },
                                }}
                              />
                            </ListItemButton>
                          );
                        })}
                      </List>
                    )}
                  </React.Fragment>
                );
              })}
            </List>
          </Collapse>
        )}

        <Divider sx={{ marginTop: 1, marginBottom: 1 }}>
          {open && <>Settings</>}
        </Divider>

        <ListItem disablePadding sx={{ display: 'block' }}>
          <ListItemButton
            LinkComponent={Link}
            selected={pathname?.startsWith('/settings/roles')}
            href="/settings/roles"
            sx={[
              { minHeight: 48, px: 2.5 },
              open
                ? { justifyContent: 'initial' }
                : { justifyContent: 'center' },
            ]}
          >
            <ListItemIcon
              sx={[
                { minWidth: 0, justifyContent: 'center' },
                open ? { mr: 3 } : { mr: 'auto' },
              ]}
            >
              <LockOpenIcon />
            </ListItemIcon>
            <ListItemText
              primary="Roles"
              sx={[open ? { opacity: 1 } : { opacity: 0 }]}
            />
          </ListItemButton>
        </ListItem>

        <ListItem disablePadding sx={{ display: 'block' }}>
          <ListItemButton
            LinkComponent={Link}
            selected={pathname?.startsWith('/settings/users')}
            href="/settings/users"
            sx={[
              { minHeight: 48, px: 2.5 },
              open
                ? { justifyContent: 'initial' }
                : { justifyContent: 'center' },
            ]}
          >
            <ListItemIcon
              sx={[
                { minWidth: 0, justifyContent: 'center' },
                open ? { mr: 3 } : { mr: 'auto' },
              ]}
            >
              <PersonIcon />
            </ListItemIcon>
            <ListItemText
              primary="User Management"
              sx={[open ? { opacity: 1 } : { opacity: 0 }]}
            />
          </ListItemButton>
        </ListItem>

        <ListItem disablePadding sx={{ display: 'block' }}>
          <ListItemButton
            LinkComponent={Link}
            selected={pathname?.startsWith('/settings/pricing')}
            href="/settings/pricing"
            sx={[
              { minHeight: 48, px: 2.5 },
              open
                ? { justifyContent: 'initial' }
                : { justifyContent: 'center' },
            ]}
          >
            <ListItemIcon
              sx={[
                { minWidth: 0, justifyContent: 'center' },
                open ? { mr: 3 } : { mr: 'auto' },
              ]}
            >
              <AttachMoneyIcon />
            </ListItemIcon>
            <ListItemText
              primary="Pricing"
              sx={[open ? { opacity: 1 } : { opacity: 0 }]}
            />
          </ListItemButton>
        </ListItem>
      </List>
    </Drawer>
  );
}
