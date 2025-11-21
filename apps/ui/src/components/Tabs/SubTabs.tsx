'use client';

import Box from '@mui/material/Box';
import { useTheme } from '@mui/material/styles';
import Tab from '@mui/material/Tab';
import useMediaQuery from '@mui/material/useMediaQuery';
import Link from 'next/link';
import VerticalTabContext from './VerticalTabContext';

export type TabDef = {
  path: string;
  name: string;
  icon?: React.ReactElement;
  value?: string;
};

export type Children = () => TabDef[];

export type SubTabsProps = {
  children: React.ReactNode;
  pathPattern?: string;
  tabs: (TabDef & { children?: Children })[];
  height?: number | string;
};

export default function SubTabs({ children, tabs, pathPattern, height }: SubTabsProps) {
  const theme = useTheme();
  const isSm = useMediaQuery(theme.breakpoints.down('sm'));

  return (
    <Box sx={{ flexGrow: 1, display: 'flex', width: '100%', flexDirection: isSm ? 'column' : 'row' }}>
      <Box
        width={isSm ? '100%' : '17%'}
        height="100%"
        sx={{
          marginRight: '1rem',
          marginBottom: isSm ? '1rem' : '0',
        }}
      >
        <VerticalTabContext pathPattern={pathPattern}>
          {tabs.flatMap((item, index) => {
            const children = item.children && item.children();
            const components = [
              <Tab
                component={Link}
                href={{
                  pathname: item.path,
                }}
                key={item.path}
                label={item.name}
                value={item.value ?? item.path}
                icon={item.icon}
                iconPosition="start"
                sx={{
                  maxWidth: 'none',
                  backgroundColor: 'background.paper',
                  borderLeft: '.1rem solid var(--mui-palette-divider)',
                  borderTop: index === 0 ? '.1rem solid var(--mui-palette-divider)' : 'none',
                  ...(index !== tabs.length || children?.length
                    ? { borderBottom: '.1rem solid var(--mui-palette-divider)' }
                    : {}),
                }}
              />,
            ];

            if (children?.length) {
              components.push(
                <VerticalTabContext
                  sx={{
                    borderRight: 'none',
                  }}
                >
                  {children.map((child) => (
                    <Tab
                      component={Link}
                      href={{
                        pathname: child.path,
                      }}
                      key={child.path}
                      label={child.name}
                      value={child.value ?? child.path}
                      sx={{
                        backgroundColor: 'background.paper',
                        borderBottom: '.1rem solid var(--mui-palette-divider)',
                        borderLeft: '.1rem solid var(--mui-palette-divider)',
                        marginLeft: '2rem',
                      }}
                    />
                  ))}
                </VerticalTabContext>,
              );
            }

            return components;
          })}
        </VerticalTabContext>
      </Box>
      <Box
        sx={{
          width: isSm ? '100%' : '83%',
          ...(height
            ? {
                height,
                overflowY: 'scroll',
              }
            : {}),
        }}
      >
        {children}
      </Box>
    </Box>
  );
}
