'use client';

import { CompletionAuditEntity } from '@/clients/api';
import Alert from '@mui/material/Alert';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import Typography from '@mui/material/Typography';
import dynamic from 'next/dynamic';

const ReactJson = dynamic(() => import('react-json-view'), { ssr: false });

export type AuditDetailProps = {
  data: CompletionAuditEntity;
};

export default function AuditDetail({ data }: AuditDetailProps) {
  return (
    <Grid container spacing={3}>
      {data.errorMessage && (
        <Grid size={12}>
          <Alert variant="filled" severity="error">
            {data.errorMessage}
          </Alert>
        </Grid>
      )}
      {data.events && data.events.length > 0 && (
        <Grid container size={12} spacing={3}>
          <Grid size={12}>
            <Typography variant="h6">Events</Typography>
            <Divider />
          </Grid>
          <Grid size={12}>
            <ReactJson src={data.events} />
          </Grid>
        </Grid>
      )}
      <>
        <Grid container size={12} spacing={3}>
          <Grid size={6}>
            <Grid size={12}>
              <Typography variant="h6">Request payload</Typography>
              <Divider />
            </Grid>
            <Grid size={12}>
              <ReactJson src={data.requestPayload ?? {}} collapsed={1} />
            </Grid>
          </Grid>
          <Grid size={6}>
            <Grid size={12}>
              <Typography variant="h6">Response payload</Typography>
              <Divider />
            </Grid>
            <Grid size={12}>
              <ReactJson src={data.responseData ?? {}} collapsed={1} />
            </Grid>
          </Grid>
        </Grid>
        <Grid container size={12} spacing={3}>
          <Grid size={6}>
            <Grid size={12}>
              <Typography variant="h6">Response headers</Typography>
              <Divider />
            </Grid>
            <Grid size={12}>
              <ReactJson src={data.responseHeaders ?? {}} collapsed={1} />
            </Grid>
          </Grid>
        </Grid>
      </>
    </Grid>
  );
}
