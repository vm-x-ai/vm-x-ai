'use client';

import { EnvironmentEntity, WorkspaceEntity } from '@/clients/api';
import Box from '@mui/material/Box';
import { useTheme } from '@mui/material/styles';
import Tab from '@mui/material/Tab';
import useMediaQuery from '@mui/material/useMediaQuery';
import Breadcrumbs from '@/components/Layout/Breadcrumbs';
import CustomTabList from '@/components/Tabs/CustomTabList';
import TabContext from '@/components/Tabs/TabContext';
import Link from 'next/link';
import { JSX } from 'react';

const userSettings = {
  layout: {
    menuIcons: false,
  },
};

type LayoutProps = {
  children: React.ReactNode;
  tabs: {
    path: string;
    name: string;
    value?: string;
    icon?: JSX.Element;
  }[];
  workspace: WorkspaceEntity;
  environment: EnvironmentEntity;
};

export default function WorkspaceTabs({
  children,
  tabs,
  workspace,
  environment,
}: LayoutProps) {
  const theme = useTheme();
  const isSm = useMediaQuery(theme.breakpoints.up('sm'));

  return (
    // Match only the first 3 elements of the URL and ignore all the rest (<workspaceId>/<environmentId>/<tab>)
    <TabContext pathPattern={'^/workspaces/[^/]+/[^/]+/[^/]+'}>
      <Box sx={{ borderBottom: 1, borderColor: 'divider', width: '100%' }}>
        <CustomTabList
          aria-label="Environment config tabs"
          variant={isSm ? 'fullWidth' : 'scrollable'}
          scrollButtons="auto"
        >
          {tabs.map((item) => (
            <Tab
              component={Link}
              href={{
                pathname: item.path,
              }}
              key={item.path}
              label={item.name}
              value={item.value || item.path}
              icon={userSettings.layout.menuIcons ? item.icon : undefined}
              iconPosition="start"
            />
          ))}
        </CustomTabList>
      </Box>
      <Box
        sx={{
          marginTop: 3,
        }}
      >
        <Box
          sx={{
            marginBottom: 1,
          }}
        >
          <Breadcrumbs workspace={workspace} environment={environment} />
        </Box>
        {children}
      </Box>
    </TabContext>
  );
}
