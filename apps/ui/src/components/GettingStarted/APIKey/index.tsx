'use client';

import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Grid from '@mui/material/Grid';
import Typography from '@mui/material/Typography';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import CopySecret from '@/components/Auth/CopySecret';
import { useMutation } from '@tanstack/react-query';
import { createApiKeyMutation } from '@/clients/api/@tanstack/react-query.gen';
import { useSearchParams } from 'next/navigation';

export default function GenerateApiKeyStep() {
  const searchParams = useSearchParams();
  const [isGenerating, setIsGenerating] = useState(false);
  const workspaceId = searchParams.get('workspaceId') || '';
  const environmentId = searchParams.get('environmentId') || '';

  const { mutateAsync, isPending, error, data } = useMutation({
    ...createApiKeyMutation(),
  });

  useEffect(() => {
    if (data?.apiKeyValue) return;
    if (!workspaceId || !environmentId) return;
    if (isGenerating) return;

    setIsGenerating(true);

    // Debounce the mutation to avoid multiple requests
    const timeout = setTimeout(() => {
      mutateAsync({
        path: {
          workspaceId,
          environmentId,
        },
        body: {
          enabled: true,
          name: 'Default',
          resources: [],
          enforceCapacity: false,
          description: 'Default Role',
          labels: ["default"]
        },
      }).finally(() => {
        setIsGenerating(false);
      });
    }, 200);

    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, environmentId]);

  return (
    <Grid container spacing={3}>
      <Grid size={12} marginTop="3rem">
        {(isPending || isGenerating) && (
          <Alert severity="info">Generating API key...</Alert>
        )}
        {error && (
          <Alert severity="error">
            Error on generating the API Key: {error.errorMessage}
          </Alert>
        )}
        {data?.apiKeyValue && (
          <Alert severity="success">
            API Key generated:
            <br />
            <br />
            <CopySecret value={data.apiKeyValue} />
            <br />
            <Typography variant="caption" color="textSecondary">
              Please save this key, it will not be shown again.
            </Typography>
          </Alert>
        )}
      </Grid>
      {!isPending && !isGenerating && (
        <Grid size={12} marginTop="1rem" marginBottom="1rem">
          <Button
            variant="contained"
            component={Link}
            href={`/workspaces/${workspaceId}/${environmentId}/ai-connections/new`}
          >
            Finish
          </Button>
        </Grid>
      )}
    </Grid>
  );
}
