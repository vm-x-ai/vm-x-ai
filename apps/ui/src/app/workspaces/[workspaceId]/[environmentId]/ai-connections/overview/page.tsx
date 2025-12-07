import Alert from '@mui/material/Alert';
import AIConnectionTable from '@/components/AIConnection/Table';
import { getAiConnections, getAiProviders } from '@/clients/api';
import { mapProviders } from '@/utils/provider';

export type PageProps = {
  params: Promise<{
    workspaceId: string;
    environmentId: string;
  }>;
};

export default async function Page({ params }: PageProps) {
  const { workspaceId, environmentId } = await params;
  const [connections, providers] = await Promise.all([
    getAiConnections({
      path: {
        workspaceId,
        environmentId,
      },
    }),
    getAiProviders(),
  ]);
  if (connections.error) {
    return (
      <Alert variant="filled" severity="error">
        Failed to load AI Connections {connections.error.errorMessage}
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
    <>
      <AIConnectionTable
        data={connections.data}
        workspaceId={workspaceId}
        environmentId={environmentId}
        providersMap={mapProviders(providers.data)}
      />
    </>
  );
}
