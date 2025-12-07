'use client';

import LockOpenIcon from '@mui/icons-material/LockOpen';
import SubTabs from '@/components/Tabs/SubTabs';
import { usePathname } from 'next/navigation';
import { use } from 'react';

type LayoutProps = {
  children: React.ReactNode;
  params: Promise<{
    workspaceId: string;
    environmentId: string;
  }>;
};

export default function Layout({ children, params }: LayoutProps) {
  const { workspaceId, environmentId } = use(params);
  const pathname = usePathname();

  const tabs = [
    {
      path: `/workspaces/${workspaceId}/${environmentId}/security/auth/role/overview`,
      value: `/workspaces/${workspaceId}/${environmentId}/security/auth/role`,
      name: 'Roles',
      icon: <LockOpenIcon />,
      children: () => {
        if (!pathname?.includes('security/auth/role/edit')) {
          return [];
        }

        const pathElements = pathname?.split('/');
        if (!pathElements) {
          return [];
        }
        const apiKeyId = pathElements[pathElements.length - 2];

        return [
          {
            path: `/workspaces/${workspaceId}/${environmentId}/security/auth/role/edit/${apiKeyId}/general`,
            name: 'General Settings',
          },
          {
            path: `/workspaces/${workspaceId}/${environmentId}/security/auth/role/edit/${apiKeyId}/capacity`,
            name: 'Capacity',
          },
        ];
      },
    },
  ];

  return (
    <SubTabs tabs={tabs} pathPattern={'^/workspaces/[^/]+/[^/]+/[^/]+/[^/]+/[^/]+'}>
      {children}
    </SubTabs>
  );
}
