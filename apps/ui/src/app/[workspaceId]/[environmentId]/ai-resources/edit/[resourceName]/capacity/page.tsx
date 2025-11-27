import Alert from '@mui/material/Alert';
import AIResourceCapacityEditForm from '@/components/AIResources/Form/Edit/Capacity';
import { getAiResourceById } from '@/clients/api';
import { submitForm } from './actions';

export const metadata = {
  title: 'VM-X AI Console - Edit AI Resource - Capacity',
  description: 'VM-X AI Console - Edit AI Resource - Capacity',
};

export type PageProps = {
  params: Promise<{
    workspaceId: string;
    environmentId: string;
    resourceName: string;
  }>;
};

export default async function Page({ params }: PageProps) {
  const { workspaceId, environmentId, resourceName } = await params;
  const resource = await getAiResourceById({
    path: {
      workspaceId,
      environmentId,
      resource: resourceName,
    },
  });
  if (resource.error) {
    return (
      <Alert variant="filled" severity="error">
        Failed to fetch resource: {resource.error.errorMessage}
      </Alert>
    );
  }

  return (
    <AIResourceCapacityEditForm
      submitAction={submitForm}
      data={resource.data}
      workspaceId={workspaceId}
      environmentId={environmentId}
    />
  );
}
