'use client';

import MUITabContext from '@mui/lab/TabContext';
import { usePathname } from 'next/navigation';

export type TabContextProps = {
  pathPattern?: string;
  children: React.ReactNode;
};

export default function TabContext({ children, pathPattern }: TabContextProps) {
  const pathname = usePathname();
  const match = pathPattern ? pathname?.match(new RegExp(pathPattern))?.[0] : pathname;

  return <MUITabContext value={match || ''}>{children}</MUITabContext>;
}
