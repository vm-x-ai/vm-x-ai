import Alert from '@mui/material/Alert';
import AIConnectionGeneralEditForm from '@/components/AIConnection/Form/Edit/General';
import {
  getAiConnectionById,
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
  const connection = await getAiConnectionById({
    path: {
      workspaceId,
      environmentId,
      connectionId,
    },
  });
  if (connection.error) {
    return (
      <Alert variant="filled" severity="error">
        Failed to fetch connection: {connection.error.errorMessage}
      </Alert>
    );
  }

  return (
    <AIConnectionGeneralEditForm
      submitAction={submitForm}
      data={connection.data}
      workspaceId={workspaceId}
      environmentId={environmentId}
    />
  );
}
