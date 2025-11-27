import Alert from '@mui/material/Alert';
import APIKeyGeneralEditForm from '@/components/Auth/APIKeys/Form/Edit/General';
import { submitForm } from './actions';
import { getAiResources, getApiKeyById, getApiKeys } from '@/clients/api';

export type PageProps = {
  params: Promise<{
    workspaceId: string;
    environmentId: string;
    roleId: string;
  }>;
};

export default async function Page({ params }: PageProps) {
  const { workspaceId, environmentId, roleId } = await params;
  const [resources, apiKeys, apiKey] = await Promise.all([
    getAiResources({
      path: {
        workspaceId,
        environmentId,
      },
    }),
    getApiKeys({
      path: {
        workspaceId,
        environmentId,
      },
    }),
    getApiKeyById({
      path: {
        workspaceId,
        environmentId,
        apiKeyId: roleId,
      },
    }),
  ]);

  if (resources.error) {
    return (
      <Alert variant="filled" severity="error">
        Failed to load resources {resources.error.errorMessage}
      </Alert>
    );
  }

  if (apiKey.error) {
    return (
      <Alert variant="filled" severity="error">
        Failed to load the role {apiKey.error.errorMessage}
      </Alert>
    );
  }

  return (
    <APIKeyGeneralEditForm
      submitAction={submitForm}
      data={apiKey.data}
      resources={resources.data}
      existingLabels={
        apiKeys.data
          ? [...new Set(apiKeys.data?.flatMap((key) => key.labels || []) || [])]
          : []
      }
      workspaceId={workspaceId}
      environmentId={environmentId}
    />
  );
}
