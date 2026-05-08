import Alert from '@mui/material/Alert';
import AIResourceTable from '@/components/AIResources/Table';
import EmptyState from '@/components/EmptyState/EmptyState';
import AddIcon from '@mui/icons-material/Add';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import { getAiResources, getAiProviders } from '@/clients/api';
import { mapProviders } from '@/utils/provider';

export type PageProps = {
  params: Promise<{
    workspaceId: string;
    environmentId: string;
  }>;
};

export default async function Page({ params }: PageProps) {
  const { workspaceId, environmentId } = await params;
  const [resources, providers] = await Promise.all([
    getAiResources({
      path: {
        workspaceId,
        environmentId,
      },
    }),
    getAiProviders(),
  ]);
  if (resources.error) {
    return (
      <Alert variant="filled" severity="error">
        Failed to load AI resources {resources.error.errorMessage}
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

  if (!resources.data || resources.data.length === 0) {
    return (
      <EmptyState
        icon={<SmartToyIcon />}
        title="No AI Resources yet"
        description="Resources wrap a connection + model with routing, fallback, and capacity rules. Create one to start serving traffic — or jump straight to the playground to test a connection without wrapping it first."
        ctaLabel="Create AI Resource"
        ctaIcon={<AddIcon />}
        ctaHref={`/workspaces/${workspaceId}/${environmentId}/ai-resources/new`}
      />
    );
  }

  return (
    <AIResourceTable
      data={resources.data}
      workspaceId={workspaceId}
      environmentId={environmentId}
      providersMap={mapProviders(providers.data)}
    />
  );
}
