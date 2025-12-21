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
import { use, useEffect, useMemo, useState } from 'react';
import { AiResourceEntity, AiProviderDto } from '@/clients/api';
import { mapProviders } from '@/utils/provider';
import { useAppStore } from '@/store/provider';

export type AIResourcePlaygroundProps = {
  workspaceId: string;
  environmentId: string;
  resourceId: string;
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
  resourceId,
  open,
  onClose,
}: AIResourcePlaygroundProps) {
  const resource = use(resourcePromise);
  const providers = use(providersPromise);
  const [stream, setStream] = useState<boolean>(true);
  const aiResourceChanges = useAppStore(
    (state) => state.aiResource?.changes?.[resourceId]
  );
  const setAiResourceChanges = useAppStore(
    (state) => state.setAiResourceChanges
  );

  const resourceData = useMemo(
    () => ({ ...resource.data, ...aiResourceChanges } as AiResourceEntity),
    [resource.data, aiResourceChanges]
  );

  useEffect(() => {
    // Reset the changes when the component unmounts
    setAiResourceChanges(resourceId, {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceId]);

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
                resource={resourceData}
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
