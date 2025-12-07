import Alert from '@mui/material/Alert';
import AIResourceRoutingEditForm from '@/components/AIResources/Form/Edit/Routing';
import { mapProviders } from '@/utils/provider';
import { submitForm } from './actions';
import { getAiResourceById } from '@/clients/api';
import { getAiConnections } from '@/clients/api';
import { getAiProviders } from '@/clients/api';

export const metadata = {
  title: 'VM-X AI Console - Edit AI Resource - Routing',
  description: 'VM-X AI Console - Edit AI Resource - Routing',
};

export type PageProps = {
  params: Promise<{
    workspaceId: string;
    environmentId: string;
    resourceId: string;
  }>;
};

export default async function Page({ params }: PageProps) {
  const { workspaceId, environmentId, resourceId } = await params;
  const [resource, connections, providers] = await Promise.all([
    getAiResourceById({
      path: {
        workspaceId,
        environmentId,
        resourceId,
      },
    }),
    getAiConnections({
      path: {
        workspaceId,
        environmentId,
      },
    }),
    getAiProviders(),
  ]);
  if (resource.error) {
    return (
      <Alert variant="filled" severity="error">
        Failed to fetch resource: {resource.error.errorMessage}
      </Alert>
    );
  }

  if (connections.error) {
    return (
      <Alert variant="filled" severity="error">
        Failed to fetch connections: {connections.error.errorMessage}
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
    <AIResourceRoutingEditForm
      submitAction={submitForm}
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
      workspaceId={workspaceId}
      environmentId={environmentId}
      connections={connections.data}
      data={resource.data}
      providersMap={mapProviders(providers.data)}
    />
  );
}
