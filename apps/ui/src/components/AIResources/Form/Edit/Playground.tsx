'use client';

import CloseIcon from '@mui/icons-material/Close';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Drawer from '@mui/material/Drawer';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormGroup from '@mui/material/FormGroup';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import Switch from '@mui/material/Switch';
import Chat from '@/components/Chat/Chat';
import type { ApiResponse } from '@/clients/types';
import { use, useState } from 'react';
import { AiResourceEntity, AiProviderDto } from '@/clients/api';
import { mapProviders } from '@/utils/provider';

export type AIResourcePlaygroundProps = {
  workspaceId: string;
  environmentId: string;
  resourcePromise: Promise<ApiResponse<AiResourceEntity>>;
  providersPromise: Promise<ApiResponse<AiProviderDto[]>>;
  open: boolean;
  onClose: () => void;
};

export default function AIResourcePlayground({
  resourcePromise,
  providersPromise,
  workspaceId,
  environmentId,
  open,
  onClose,
}: AIResourcePlaygroundProps) {
  const resource = use(resourcePromise);
  const providers = use(providersPromise);
  const [stream, setStream] = useState<boolean>(true);

  return (
    <>
      <Drawer
        anchor="bottom"
        variant="persistent"
        open={open}
        onClose={onClose}
      >
        <Box position="relative">
          <Box
            sx={{
              position: 'absolute',
              right: '0',
              top: '0',
            }}
          >
            <IconButton
              onClick={onClose}
              aria-label="close"
              color="primary"
              size="medium"
            >
              <CloseIcon fontSize="medium" />
            </IconButton>
          </Box>
        </Box>
        <Box position="relative">
          <Box
            sx={{
              position: 'absolute',
              top: '2rem',
              right: '3.5rem',
              backgroundColor: 'var(--mui-palette-background-paper)',
              borderRadius: '1rem',
              zIndex: 1000,
            }}
          >
            <FormGroup>
              <FormControlLabel
                control={
                  <Switch
                    checked={stream}
                    onChange={(event) => {
                      setStream(event.target.checked);
                    }}
                  />
                }
                label="Streaming"
              />
            </FormGroup>
          </Box>
        </Box>
        <Grid
          container
          sx={{
            borderTop: '.2rem solid var(--mui-palette-divider)',
          }}
        >
          <Grid size={12}>
            {!resource.data && (
              <Alert variant="filled" severity="error">
                Failed to fetch resource: {resource.error.errorMessage}
              </Alert>
            )}
            {!providers.data && (
              <Alert variant="filled" severity="error">
                Failed to fetch providers: {providers.error.errorMessage}
              </Alert>
            )}
            {resource.data && providers.data && (
              <Chat
                resource={resource.data}
                providersMap={mapProviders(providers.data)}
                workspaceId={workspaceId}
                environmentId={environmentId}
                height="46vh"
                stream={stream}
              />
            )}
          </Grid>
        </Grid>
      </Drawer>
    </>
  );
}
