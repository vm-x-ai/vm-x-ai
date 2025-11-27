import Alert from '@mui/material/Alert';
import CreateAPIKeyForm from '@/components/Auth/APIKeys/Form/Create';
import { submitForm } from './actions';
import { getAiResources, getApiKeys } from '@/clients/api';

export const metadata = {
  title: 'VM-X AI Console - Security - Auth - New Role',
  description: 'VM-X AI Console - Security - Auth - New Role',
};

export type PageProps = {
  params: Promise<{
    workspaceId: string;
    environmentId: string;
  }>;
};

export default async function Page({ params }: PageProps) {
  const { workspaceId, environmentId } = await params;
  const resources = await getAiResources({
    path: {
      workspaceId,
      environmentId,
    },
  });
  if (resources.error) {
    return (
      <Alert variant="filled" severity="error">
        Failed to load resources {resources.error.errorMessage}
      </Alert>
    );
  }

  const apiKeys = await getApiKeys({
    path: {
      workspaceId,
      environmentId,
    },
  });
  if (apiKeys.error) {
    return (
      <Alert variant="filled" severity="error">
        Failed to load API keys {apiKeys.error.errorMessage}
      </Alert>
    );
  }

  return (
    <CreateAPIKeyForm
      submitAction={submitForm}
      resources={resources.data}
      existingLabels={apiKeys.data.flatMap((key) => key.labels || [])}
      workspaceId={workspaceId}
      environmentId={environmentId}
    />
  );
}
