import { getWorkspaceById } from '@/clients/api';
import WorkspaceEditForm from '@/components/Workspace/Form/Edit';
import Alert from '@mui/material/Alert';
import { submitForm } from './actions';

export type PageProps = {
  params: Promise<{
    workspaceId: string;
  }>;
};

export default async function Page({ params }: PageProps) {
  const { workspaceId } = await params;
  const workspace = await getWorkspaceById({
    path: {
      workspaceId,
    },
  });
  if (workspace.error) {
    return (
      <Alert variant="filled" severity="error">
        Failed to fetch workspace: {workspace.error.errorMessage}
      </Alert>
    );
  }

  return (
    <WorkspaceEditForm workspace={workspace.data} submitAction={submitForm} />
  );
}
