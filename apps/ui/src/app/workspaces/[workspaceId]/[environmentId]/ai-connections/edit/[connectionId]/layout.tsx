import SubTabs from '@/components/Tabs/SubTabs';

export const metadata = {
  title: 'VM-X AI Console - Edit AI Connection',
  description: 'VM-X AI Console - Edit AI Connection',
};

type LayoutProps = {
  children: React.ReactNode;
  params: Promise<{
    workspaceId: string;
    environmentId: string;
    connectionId: string;
  }>;
};

export default async function Layout({ children, params }: LayoutProps) {
  const { workspaceId, environmentId, connectionId } = await params;
  const tabs = [
    {
      path: `/workspaces/${workspaceId}/${environmentId}/ai-connections/edit/${connectionId}/general`,
      name: 'General Settings',
    },
    {
      path: `/workspaces/${workspaceId}/${environmentId}/ai-connections/edit/${connectionId}/provider`,
      name: 'Provider',
    },
    {
      path: `/workspaces/${workspaceId}/${environmentId}/ai-connections/edit/${connectionId}/capacity`,
      name: 'Capacity',
    },
  ];

  return <SubTabs tabs={tabs}>{children}</SubTabs>;
}
