import Grid from '@mui/material/Grid';
import Skeleton from '@mui/material/Skeleton';

/**
 * Replaces the previous "Loading usage..." text with a skeletoned
 * shape that matches the actual page layout (header bar + four chart
 * accordion cards). Keeps perceived perf high while server-side data
 * fetches roundtrip — most charts take 300-800ms on a warm DB.
 */
export default function LoadingPage() {
  return (
    <Grid container spacing={3}>
      <Grid size={12}>
        <Skeleton variant="rounded" height={56} />
      </Grid>
      <Grid size={12}>
        <Skeleton variant="rounded" height={42} />
      </Grid>
      {[0, 1, 2, 3].map((i) => (
        <Grid size={12} key={i}>
          <Skeleton variant="rounded" height={280} />
        </Grid>
      ))}
    </Grid>
  );
}
