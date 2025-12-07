import { getWorkspaces } from '@/clients/api';
import TabContent from '@/components/Tabs/TabContent';
import WorkspaceTable from '@/components/Workspace/Table';
import { redirect } from 'next/navigation';

export default async function Page() {
  const workspaces = await getWorkspaces();
  if (!workspaces.data?.length) {
    redirect('/getting-started');
  }

  return (
    <TabContent>
      <WorkspaceTable workspaces={workspaces.data} />
    </TabContent>
  );
}
