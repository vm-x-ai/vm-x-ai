import { getAiProviders, getAiResourceById } from '@/clients/api';
import AIResourceTabs from '@/components/AIResources/Form/Edit/Tabs';

export const metadata = {
  title: 'VM-X AI Console - Edit AI Resource',
  description: 'VM-X AI Console - Edit AI Resource',
};

type LayoutProps = {
  children: React.ReactNode;
  params: Promise<{
    workspaceId: string;
    environmentId: string;
    resourceId: string;
  }>;
};

export default async function Layout({ children, params }: LayoutProps) {
  const { workspaceId, environmentId, resourceId } = await params;
  const tabs = [
    {
      path: `/workspaces/${workspaceId}/${environmentId}/ai-resources/edit/${resourceId}/general`,
      name: 'General Settings',
    },
    {
      path: `/workspaces/${workspaceId}/${environmentId}/ai-resources/edit/${resourceId}/routing`,
      name: 'Dynamic Routing',
    },
    {
      path: `/workspaces/${workspaceId}/${environmentId}/ai-resources/edit/${resourceId}/multi-answer`,
      name: 'Multi-Answer',
    },
    {
      path: `/workspaces/${workspaceId}/${environmentId}/ai-resources/edit/${resourceId}/fallback`,
      name: 'Fallback',
    },
    {
      path: `/workspaces/${workspaceId}/${environmentId}/ai-resources/edit/${resourceId}/capacity`,
      name: 'Capacity',
    },
  ];

  return (
    <AIResourceTabs
      tabs={tabs}
      resourcePromise={getAiResourceById({
        path: {
          workspaceId,
          environmentId,
          resourceId,
        },
      }).then(({ response, ...data }) => data)}
      workspaceId={workspaceId}
      environmentId={environmentId}
      providersPromise={getAiProviders().then(({ response, ...data }) => data)}
    >
      {children}
    </AIResourceTabs>
  );
}
