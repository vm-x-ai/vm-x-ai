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
    resourceName: string;
  }>;
};

export default async function Layout({ children, params }: LayoutProps) {
  const { workspaceId, environmentId, resourceName } = await params;
  const tabs = [
    {
      path: `/${workspaceId}/${environmentId}/ai-resources/edit/${resourceName}/general`,
      name: 'General Settings',
    },
    {
      path: `/${workspaceId}/${environmentId}/ai-resources/edit/${resourceName}/routing`,
      name: 'Dynamic Routing',
    },
    {
      path: `/${workspaceId}/${environmentId}/ai-resources/edit/${resourceName}/multi-answer`,
      name: 'Multi-Answer',
    },
    {
      path: `/${workspaceId}/${environmentId}/ai-resources/edit/${resourceName}/fallback`,
      name: 'Fallback',
    },
    {
      path: `/${workspaceId}/${environmentId}/ai-resources/edit/${resourceName}/capacity`,
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
          resource: resourceName,
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
