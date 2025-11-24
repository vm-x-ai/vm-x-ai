'use client';

import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import Typography from '@mui/material/Typography';
import OpenAIAdapterGuide from './OpenAIAdapterGuide';

export type SDKDetailsProps = {
  workspaceId: string;
  environmentId: string;
  baseUrl: string;
  resource?: string;
  showEnvironmentDetails?: boolean;
};

export default function SDKDetails({
  workspaceId,
  environmentId,
  baseUrl,
  resource,
  showEnvironmentDetails = true,
}: SDKDetailsProps) {
  return (
    <Grid container spacing={3}>
      {showEnvironmentDetails && (
        <>
          <Grid size={12}>
            <Typography variant="h6">Environment Details</Typography>
            <Divider />
          </Grid>
          <Grid size={12}>
            <Grid container>
              <Grid size={6}>
                <Typography variant="subtitle2">Workspace ID:</Typography>
                <Typography variant="body2">{workspaceId}</Typography>
              </Grid>
              <Grid size={6}>
                <Typography variant="subtitle2">Environment ID:</Typography>
                <Typography variant="body2">{environmentId}</Typography>
              </Grid>
            </Grid>
            <Grid container marginTop="1rem">
              <Grid size={12}>
                <Typography variant="subtitle2">Base URL:</Typography>
                <Typography variant="body2">{baseUrl}</Typography>
              </Grid>
            </Grid>
          </Grid>
        </>
      )}
      <Grid size={12}>
        <OpenAIAdapterGuide
          workspaceId={workspaceId}
          environmentId={environmentId}
          baseUrl={baseUrl}
          resource={resource}
        />
      </Grid>
    </Grid>
  );
}
