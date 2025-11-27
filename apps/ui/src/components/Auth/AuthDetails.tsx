import Alert from '@mui/material/Alert';
import Grid from '@mui/material/Grid';
import APIKeysTable from '@/components/Auth/APIKeys/Table';
import { getAiResources, getApiKeys } from '@/clients/api';

type AuthDetailsProps = {
  workspaceId: string;
  environmentId: string;
};

export default async function AuthDetails({
  workspaceId,
  environmentId,
}: AuthDetailsProps) {
  const apiKeys = await getApiKeys({
    path: {
      workspaceId,
      environmentId,
    },
  });
  if (apiKeys.error) {
    return (
      <Alert variant="filled" severity="error">
        Failed to load roles: {apiKeys.error.errorMessage}
      </Alert>
    );
  }

  const resources = await getAiResources({
    path: {
      workspaceId,
      environmentId,
    },
  });
  if (resources.error) {
    return (
      <Alert variant="filled" severity="error">
        Failed to load Resources: {resources.error.errorMessage}
      </Alert>
    );
  }

  return (
    <Grid container spacing={3}>
      <Grid size={12}>
        <APIKeysTable
          data={apiKeys.data}
          resources={resources.data.map((item) => item.resource)}
          environmentId={environmentId}
          workspaceId={workspaceId}
        />
      </Grid>
    </Grid>
  );
}
