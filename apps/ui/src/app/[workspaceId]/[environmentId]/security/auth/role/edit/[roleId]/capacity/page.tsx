import Alert from '@mui/material/Alert';
import APIKeyCapacityEditForm from '@/components/Auth/APIKeys/Form/Edit/Capacity';
import { submitForm } from './actions';
import { getApiKeyById } from '@/clients/api';

export type PageProps = {
  params: Promise<{
    workspaceId: string;
    environmentId: string;
    roleId: string;
  }>;
};

export default async function Page({ params }: PageProps) {
  const { workspaceId, environmentId, roleId } = await params;
  const { error, data: apiKey } = await getApiKeyById({
    path: {
      workspaceId,
      environmentId,
      apiKeyId: roleId,
    },
  });
  if (error) {
    return (
      <Alert variant="filled" severity="error">
        Failed to fetch role: {error.errorMessage}
      </Alert>
    );
  }

  return (
    <APIKeyCapacityEditForm
      submitAction={submitForm}
      data={apiKey}
      workspaceId={workspaceId}
      environmentId={environmentId}
    />
  );
}
