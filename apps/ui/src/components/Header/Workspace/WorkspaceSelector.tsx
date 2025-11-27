'use client';

import Alert from '@mui/material/Alert';
import WorkspaceSelectorMenu from './WorkspaceSelectorMenu';
import { useQuery } from '@tanstack/react-query';
import { getWorkspacesOptions } from '@/clients/api/@tanstack/react-query.gen';

export default function WorkspaceSelector() {
  const { error, data, isLoading } = useQuery({
    ...getWorkspacesOptions({
      query: {
        includesEnvironments: true,
      },
    }),
  });

  if (error) {
    return (
      <Alert variant="filled" severity="error">
        Error loading workspaces: {error.errorMessage}
      </Alert>
    );
  }

  if (isLoading) {
    return <div>Loading workspaces...</div>;
  }

  if (data?.length === 0) {
    return <></>;
  }

  return <WorkspaceSelectorMenu workspaces={data ?? []} />;
}
