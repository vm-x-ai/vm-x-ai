import Alert from '@mui/material/Alert';
import PoolDefinitionTable from '@/components/Prioritization/Table';
import {
  AiResourceEntity,
  getAiResources,
  getPoolDefinition,
} from '@/clients/api';

export type PageProps = {
  params: Promise<{
    workspaceId: string;
    environmentId: string;
  }>;
};

export default async function Page({ params }: PageProps) {
  const { workspaceId, environmentId } = await params;
  const [poolDefinition, resources] = await Promise.all([
    getPoolDefinition({ path: { workspaceId, environmentId } }),
    getAiResources({ path: { workspaceId, environmentId } }),
  ]);
  if (poolDefinition.error) {
    return (
      <Alert variant="filled" severity="error">
        Failed to load pool definition {poolDefinition.error.errorMessage}
      </Alert>
    );
  }

  if (resources.error) {
    return (
      <Alert variant="filled" severity="error">
        Failed to load resources {resources.error.errorMessage}
      </Alert>
    );
  }

  return (
    <>
      <PoolDefinitionTable
        data={poolDefinition.data}
        workspaceId={workspaceId}
        environmentId={environmentId}
        resourcesMap={resources.data.reduce((acc, item) => {
          acc[item.resourceId] = item;
          return acc;
        }, {} as Record<string, AiResourceEntity>)}
      />
    </>
  );
}
