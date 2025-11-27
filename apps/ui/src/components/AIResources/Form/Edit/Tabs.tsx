'use client';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import SubTabs from '@/components/Tabs/SubTabs';
import { useState } from 'react';
import AIResourcePlayground from './Playground';
import { ApiResponse } from '@/clients/types';
import {
  AiResourceEntity,
  AiProviderDto,
} from '@/clients/api';

export type AIResourceTabsProps = {
  tabs: {
    path: string;
    name: string;
  }[];
  workspaceId: string;
  environmentId: string;
  children: React.ReactNode;
  resourcePromise: Promise<ApiResponse<AiResourceEntity>>;
  providersPromise: Promise<ApiResponse<AiProviderDto[]>>;
};

export default function AIResourceTabs({
  tabs,
  resourcePromise,
  providersPromise,
  workspaceId,
  environmentId,
  children,
}: AIResourceTabsProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <SubTabs tabs={tabs} height={open ? 'calc(50vh - 11.5rem)' : undefined}>
        <Box
          sx={{
            p: 3,
            backgroundColor: 'var(--mui-palette-background-paper)',
            border: '.1rem solid var(--mui-palette-divider)',
          }}
        >
          <Box
            sx={{
              position: 'relative',
            }}
          >
            <Box
              sx={{
                position: 'absolute',
                top: '-0.6rem',
                right: '0',
              }}
            >
              <Button onClick={() => setOpen((prev) => !prev)}>
                {open ? 'Close' : 'Open'} playground
              </Button>
            </Box>
          </Box>
          {children}
        </Box>
      </SubTabs>
      <AIResourcePlayground
        open={open}
        onClose={() => {
          setOpen((prev) => !prev);
        }}
        workspaceId={workspaceId}
        environmentId={environmentId}
        resourcePromise={resourcePromise}
        providersPromise={providersPromise}
      />
    </>
  );
}
