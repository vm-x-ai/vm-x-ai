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

  // Render `null` during the loading slice rather than a divergent
  // `<div>Loading workspaces...</div>` placeholder. With server-side
  // prefetching, the server may already have the data while the
  // first client render still sees `isLoading: true`, and any
  // differing markup between the two triggers a hydration mismatch.
  // `null` matches what the wrapping `<Suspense fallback={null}>` in
  // Sidebar would render.
  if (isLoading || data?.length === 0) {
    return null;
  }

  return <WorkspaceSelectorMenu workspaces={data ?? []} />;
}
