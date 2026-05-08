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

/**
 * Resource-edit layout. The legacy `tabs` array (and the resource +
 * providers prefetch promises that fed an inline playground panel)
 * have been removed — the sub-tabs now live in the main sidebar's
 * `AI Resources` group, and the inline playground was retired in
 * favour of the dedicated `/playground` page. The shell here just
 * wraps children in the bordered AIResourceTabs frame.
 */
export default async function Layout({ children, params }: LayoutProps) {
  const { workspaceId, environmentId, resourceId } = await params;
  return (
    <AIResourceTabs
      resourceId={resourceId}
      workspaceId={workspaceId}
      environmentId={environmentId}
    >
      {children}
    </AIResourceTabs>
  );
}
