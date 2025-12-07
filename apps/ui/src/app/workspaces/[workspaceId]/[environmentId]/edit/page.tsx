import { getEnvironmentById } from '@/clients/api';
import Alert from '@mui/material/Alert';
import { submitForm } from './actions';
import EnvironmentEditForm from '@/components/Environment/Form/Edit';

export type PageProps = {
  params: Promise<{
    workspaceId: string;
    environmentId: string;
  }>;
};

export default async function Page({ params }: PageProps) {
  const { workspaceId, environmentId } = await params;
  const environment = await getEnvironmentById({
    path: {
      workspaceId,
      environmentId,
    },
  });
  if (environment.error) {
    return (
      <Alert variant="filled" severity="error">
        Failed to fetch environment: {environment.error.errorMessage}
      </Alert>
    );
  }

  return (
    <EnvironmentEditForm
      environment={environment.data}
      submitAction={submitForm}
    />
  );
}
