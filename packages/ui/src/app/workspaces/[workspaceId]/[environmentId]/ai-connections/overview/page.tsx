import Alert from '@mui/material/Alert';
import AIConnectionTable from '@/components/AIConnection/Table';
import EmptyState from '@/components/EmptyState/EmptyState';
import AddIcon from '@mui/icons-material/Add';
import ElectricalServicesIcon from '@mui/icons-material/ElectricalServices';
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

  if (!connections.data || connections.data.length === 0) {
    return (
      <EmptyState
        icon={<ElectricalServicesIcon />}
        title="No AI Connections yet"
        description="An AI Connection holds a provider's API key (OpenAI, Anthropic, AWS Bedrock, …). Add one to start serving completions through VM-X."
        ctaLabel="Add new AI Connection"
        ctaIcon={<AddIcon />}
        ctaHref={`/workspaces/${workspaceId}/${environmentId}/ai-connections/new`}
      />
    );
  }

  return (
    <AIConnectionTable
      data={connections.data}
      workspaceId={workspaceId}
      environmentId={environmentId}
      providersMap={mapProviders(providers.data)}
    />
  );
}
