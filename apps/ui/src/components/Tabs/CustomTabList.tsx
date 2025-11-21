'use client';

import type { TabListProps } from '@mui/lab';
import { TabList } from '@mui/lab';
import { styled } from '@mui/material/styles';

const CustomTabList: React.FC<TabListProps> = styled((props: TabListProps) => (
  <TabList {...props} />
))(({ theme }) => ({
  border: '.1rem solid var(--mui-palette-divider)',
  backgroundColor: 'var(--mui-palette-background-paper)',

  '& .MuiTabs-indicator': {
    height: '.2rem',
    backgroundColor: theme.palette.secondary.main,
    transform: 'scaleX(0.8)',
    transformOrigin: 'center',
  },

  '& .MuiTabs-indicator::after': {
    content: '""',
    display: 'block',
    position: 'absolute',
    width: '100%', // versus the previous line (same width)
    height: '.2rem',
    backgroundColor: theme.palette.primary.main, // Dark blue
    bottom: '.2rem',
  },
}));

export default CustomTabList;
