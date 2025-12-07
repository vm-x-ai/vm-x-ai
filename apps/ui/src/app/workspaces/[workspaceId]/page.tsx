import { getEnvironments } from '@/clients/api';
import Alert from '@mui/material/Alert';
import { redirect } from 'next/navigation';

type PageProps = {
  params: Promise<{
    workspaceId: string;
  }>;
};

export default async function Page({ params }: PageProps) {
  const { workspaceId } = await params;
  const { error, data } = await getEnvironments({
    path: {
      workspaceId,
    },
  });
  if (error) {
    return (
      <Alert variant="filled" severity="error">
        Failed to fetch environment: {error.errorMessage}
      </Alert>
    );
  }

  if (data.length === 0) {
    redirect(`/getting-started?workspaceId=${workspaceId}`);
  }

  redirect(`/workspaces/${workspaceId}/${data[0].environmentId}/ai-connections/overview`);
}
