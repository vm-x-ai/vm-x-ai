import Alert from '@mui/material/Alert';
import AIConnectionGeneralEditForm from '@/components/AIConnection/Form/Edit/Provider';
import {
  getAiConnectionById,
  getAiProviders,
  getEnvironmentById,
} from '@/clients/api';
import { mapProviders } from '@/utils/provider';
import { submitForm } from './actions';

export type PageProps = {
  params: Promise<{
    workspaceId: string;
    environmentId: string;
    connectionId: string;
  }>;
};

export default async function Page({ params }: PageProps) {
  const { workspaceId, environmentId, connectionId } = await params;
  const [connection, environment, providers] = await Promise.all([
    getAiConnectionById({
      path: {
        workspaceId,
        environmentId,
        connectionId,
      },
    }),
    getEnvironmentById({
      path: {
        workspaceId,
        environmentId,
      },
    }),
    getAiProviders(),
  ]);
  if (connection.error) {
    return (
      <Alert variant="filled" severity="error">
        Failed to fetch connection: {connection.error.errorMessage}
      </Alert>
    );
  }

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

  return (
    <AIConnectionGeneralEditForm
      submitAction={submitForm}
      workspaceId={workspaceId}
      data={connection.data}
      environment={environment.data}
      providersMap={mapProviders(providers.data)}
    />
  );
}
