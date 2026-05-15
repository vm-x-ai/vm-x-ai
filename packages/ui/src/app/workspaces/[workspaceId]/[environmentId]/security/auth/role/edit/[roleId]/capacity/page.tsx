import Alert from '@mui/material/Alert';
import APIKeyCapacityEditForm from '@/components/Auth/APIKeys/Form/Edit/Capacity';
import { submitForm } from './actions';
import { getApiKeyById, getRequestAuditMetadataKeys } from '@/clients/api';

export type PageProps = {
  params: Promise<{
    workspaceId: string;
    environmentId: string;
    roleId: string;
  }>;
};

export default async function Page({ params }: PageProps) {
  const { workspaceId, environmentId, roleId } = await params;
  const [apiKeyResult, metadataKeys] = await Promise.all([
    getApiKeyById({
      path: {
        workspaceId,
        environmentId,
        apiKeyId: roleId,
      },
    }),
    getRequestAuditMetadataKeys({
      path: {
        workspaceId,
        environmentId,
      },
    }),
  ]);
  if (apiKeyResult.error) {
    return (
      <Alert variant="filled" severity="error">
        Failed to fetch role: {apiKeyResult.error.errorMessage}
      </Alert>
    );
  }

  return (
    <APIKeyCapacityEditForm
      submitAction={submitForm}
      data={apiKeyResult.data}
      workspaceId={workspaceId}
      environmentId={environmentId}
      metadataKeys={metadataKeys.data ?? []}
    />
  );
}
