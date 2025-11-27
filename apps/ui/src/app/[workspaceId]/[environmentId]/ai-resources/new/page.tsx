import Alert from '@mui/material/Alert';
import CreateAIResourceForm from '@/components/AIResources/Form/Create';
import { getAiConnections, getApiKeys, getAiProviders } from '@/clients/api';
import { submitForm } from './actions';
import { mapProviders } from '@/utils/provider';

export const metadata = {
  title: 'VM-X AI Console - New AI Resource',
  description: 'VM-X AI Console - New AI Resource',
};

export type PageProps = {
  params: Promise<{
    workspaceId: string;
    environmentId: string;
  }>;
};

export default async function Page({ params }: PageProps) {
  const { workspaceId, environmentId } = await params;
  const [aiConnections, apiKeys, providers] = await Promise.all([
    getAiConnections({
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
  if (aiConnections.error) {
    return (
      <Alert variant="filled" severity="error">
        Failed to load AI connections {aiConnections.error.errorMessage}
      </Alert>
    );
  }

  if (apiKeys.error) {
    return (
      <Alert variant="filled" severity="error">
        Failed to load security roles {apiKeys.error.errorMessage}
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

  return (
    <CreateAIResourceForm
      submitAction={submitForm}
      apiKeys={apiKeys.data}
      providersMap={mapProviders(providers.data)}
      connections={aiConnections.data}
      workspaceId={workspaceId}
      environmentId={environmentId}
      refreshConnectionAction={async () => {
        'use server';

        const refreshConnections = await getAiConnections({
          path: {
            workspaceId,
            environmentId,
          },
        });
        return refreshConnections.error ? [] : refreshConnections.data;
      }}
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
