'use client';

import type { SxProps, Theme } from '@mui/material/styles';
import Tabs from '@mui/material/Tabs';
import { usePathname } from 'next/navigation';

export type VerticalTabContextProps = {
  pathPattern?: string;
  children: React.ReactNode;
  sx?: SxProps<Theme>;
};

export default function VerticalTabContext({ children, pathPattern, sx }: VerticalTabContextProps) {
  const pathname = usePathname();
  const match = pathPattern ? pathname?.match(new RegExp(pathPattern))?.[0] : pathname;

  return (
    <Tabs
      orientation="vertical"
      variant="scrollable"
      value={match}
      sx={{ borderRight: 1, borderColor: 'divider', ...(sx || {}) }}
    >
      {children}
    </Tabs>
  );
}
