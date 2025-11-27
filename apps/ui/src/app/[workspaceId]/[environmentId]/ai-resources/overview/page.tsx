import Alert from '@mui/material/Alert';
import AIResourceTable from '@/components/AIResources/Table';
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

  return (
    <>
      <AIResourceTable
        data={resources.data}
        workspaceId={workspaceId}
        environmentId={environmentId}
        providersMap={mapProviders(providers.data)}
      />
    </>
  );
}
