import Grid from '@mui/material/Grid';
import AuditTable from '@/components/Audit/Table';

export default async function LoadingPage() {
  return (
    <Grid container spacing={3}>
      <Grid size={12}>
        <AuditTable loading />
      </Grid>
    </Grid>
  );
}
