import Alert from '@mui/material/Alert';
import CreateAIConnectionForm from '@/components/AIConnection/Form/Create';
import { mapProviders } from '@/utils/provider';
import { submitForm } from './actions';
import { getAiProviders, getApiKeys, getEnvironmentById } from '@/clients/api';

export const metadata = {
  title: 'VM-X AI Console - New AI Connection',
  description: 'VM-X AI Console - New AI Connection',
};

export type PageProps = {
  params: Promise<{
    workspaceId: string;
    environmentId: string;
  }>;
};

export default async function Page({ params }: PageProps) {
  const { workspaceId, environmentId } = await params;
  const [environment, apiKeys, providers] = await Promise.all([
    getEnvironmentById({
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
    getAiProviders(),
  ]);
  if (environment.error) {
    return (
      <Alert variant="filled" severity="error">
        Failed to fetch environment: {environment.error.errorMessage}
      </Alert>
    );
  }

  if (providers.error) {
    return (
      <Alert variant="filled" severity="error">
        Failed to fetch providers: {providers.error.errorMessage}
      </Alert>
    );
  }

  if (apiKeys.error) {
    return (
      <Alert variant="filled" severity="error">
        Failed to fetch API keys: {apiKeys.error.errorMessage}
      </Alert>
    );
  }

  return (
    <CreateAIConnectionForm
      submitAction={submitForm}
      workspaceId={workspaceId}
      environment={environment.data}
      baseUrl={process.env.API_BASE_URL as string}
      providersMap={mapProviders(providers.data)}
      apiKeys={apiKeys.data}
      refreshApiKeyAction={async () => {
        'use server';

        const refreshKeys = await getApiKeys({
          path: {
            workspaceId,
            environmentId,
          },
        });
        return refreshKeys.error ? [] : refreshKeys.data;
      }}
    />
  );
}
