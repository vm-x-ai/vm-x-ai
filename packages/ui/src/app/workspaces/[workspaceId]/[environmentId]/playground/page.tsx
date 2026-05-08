import Alert from '@mui/material/Alert';
import {
  getAiConnections,
  getAiProviders,
  getAiResources,
} from '@/clients/api';
import { mapProviders } from '@/utils/provider';
import PlaygroundClient from '@/components/Playground/PlaygroundClient';

export const metadata = {
  title: 'VM-X AI Console - Playground',
  description: 'VM-X AI Playground',
};

export type PageProps = {
  params: Promise<{
    workspaceId: string;
    environmentId: string;
  }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Page({ params, searchParams }: PageProps) {
  const { workspaceId, environmentId } = await params;
  const sp = (await searchParams) ?? {};
  const initialResourceId =
    typeof sp.resourceId === 'string' ? sp.resourceId : undefined;

  const [resources, connections, providers] = await Promise.all([
    getAiResources({
      path: { workspaceId, environmentId },
    }),
    getAiConnections({
      path: { workspaceId, environmentId },
    }),
    getAiProviders(),
  ]);

  if (resources.error) {
    return (
      <Alert variant="filled" severity="error">
        Failed to load AI resources: {resources.error.errorMessage}
      </Alert>
    );
  }
  if (connections.error) {
    return (
      <Alert variant="filled" severity="error">
        Failed to load AI connections: {connections.error.errorMessage}
      </Alert>
    );
  }
  if (providers.error) {
    return (
      <Alert variant="filled" severity="error">
        Failed to load AI providers: {providers.error.errorMessage}
      </Alert>
    );
  }

  return (
    <PlaygroundClient
      workspaceId={workspaceId}
      environmentId={environmentId}
      resources={resources.data ?? []}
      connections={connections.data ?? []}
      providersMap={mapProviders(providers.data)}
      initialResourceId={initialResourceId}
    />
  );
}
