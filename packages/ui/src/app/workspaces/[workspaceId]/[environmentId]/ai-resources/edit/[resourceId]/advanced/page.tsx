import Alert from '@mui/material/Alert';
import AIResourceAdvancedEditForm from '@/components/AIResources/Form/Edit/Advanced';
import { submitForm } from './actions';
import { getAiResourceById } from '@/clients/api';

export type PageProps = {
  params: Promise<{
    workspaceId: string;
    environmentId: string;
    resourceId: string;
  }>;
};

export default async function Page({ params }: PageProps) {
  const { workspaceId, environmentId, resourceId } = await params;
  const resource = await getAiResourceById({
    path: { workspaceId, environmentId, resourceId },
  });

  if (resource.error) {
    return (
      <Alert variant="filled" severity="error">
        Failed to fetch resource: {resource.error.errorMessage}
      </Alert>
    );
  }

  return (
    <AIResourceAdvancedEditForm
      submitAction={submitForm}
      data={resource.data}
      workspaceId={workspaceId}
      environmentId={environmentId}
    />
  );
}
