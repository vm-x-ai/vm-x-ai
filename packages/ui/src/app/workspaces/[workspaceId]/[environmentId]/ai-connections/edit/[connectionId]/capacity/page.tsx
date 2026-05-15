import Alert from '@mui/material/Alert';
import AIConnectionCapacityEditForm from '@/components/AIConnection/Form/Edit/Capacity';
import {
  getAiConnectionById,
  getRequestAuditMetadataKeys,
} from '@/clients/api';
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
  const [connection, metadataKeys] = await Promise.all([
    getAiConnectionById({
      path: {
        workspaceId,
        environmentId,
        connectionId,
      },
    }),
    getRequestAuditMetadataKeys({
      path: {
        workspaceId,
        environmentId,
      },
    }),
  ]);
  if (connection.error) {
    return (
      <Alert variant="filled" severity="error">
        Failed to fetch connection: {connection.error.errorMessage}
      </Alert>
    );
  }

  return (
    <AIConnectionCapacityEditForm
      submitAction={submitForm}
      workspaceId={workspaceId}
      environmentId={environmentId}
      data={connection.data}
      metadataKeys={metadataKeys.data ?? []}
    />
  );
}
