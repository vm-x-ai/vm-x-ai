'use client';

import type { TabListProps } from '@mui/lab';
import { TabList } from '@mui/lab';
import { styled } from '@mui/material/styles';

const CustomTabList: React.FC<TabListProps> = styled((props: TabListProps) => (
  <TabList {...props} />
))(({ theme }) => ({
  border: '1px solid var(--mui-palette-divider)',
  backgroundColor: 'var(--mui-palette-background-paper)',

  // Single solid primary-colour underline; the previous two-layer
  // indicator combined `secondary.main` (now near-black under the new
  // palette) with `primary.main`, which collapsed to a near-black bar
  // in light mode. A flat primary indicator reads better against the
  // hairline-bordered tab list.
  '& .MuiTabs-indicator': {
    height: '2px',
    backgroundColor: theme.palette.primary.main,
  },
}));

export default CustomTabList;
