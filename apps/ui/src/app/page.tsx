import { getEnvironments, getWorkspaces } from '@/clients/api';
import { redirect } from 'next/navigation';

export default async function Page() {
  const workspaces = await getWorkspaces();
  if (!workspaces.data?.length) {
    redirect('/getting-started');
  }

  const workspaceId = workspaces.data[0].workspaceId;
  const environments = await getEnvironments({
    path: {
      workspaceId,
    },
  });

  if (environments.data && environments.data.length === 0) {
    redirect(`/getting-started?workspaceId=${workspaceId}`);
  }

  redirect(
    `/workspaces/${workspaceId}/${environments.data?.[0]?.environmentId}/ai-connections/overview`
  );
}
