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
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Chat, { type ChatEndpointMode } from '@/components/Chat/Chat';
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
  const [endpointMode, setEndpointMode] =
    useState<ChatEndpointMode>('chat-completions');
  // Web-search toggle. When enabled, the BFF adds the right passthrough
  // for the active endpoint:
  //   - Chat Completions: `web_search_options: {}` (OpenAI), Perplexity
  //     sonar models do this implicitly so the flag is a no-op there
  //   - Responses API: `tools: [{ type: 'web_search_preview' }]`
  // Providers that don't recognize the field ignore it. Gemini's native
  // googleSearch tool is a follow-up — gate with provider awareness later.
  const [webSearch, setWebSearch] = useState<boolean>(false);
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
        <Box
          sx={{
            position: 'relative',
          }}
        >
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
        <Box
          sx={{
            position: 'relative',
          }}
        >
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
            <Box
              sx={{
                display: 'flex',
                gap: 1.5,
                alignItems: 'center',
                px: 1.5,
              }}
            >
              {/*
                Endpoint mode toggle. Phase 1: text-only Responses API.
                See `useResponsesStream.ts` for the supported events.
              */}
              <ToggleButtonGroup
                size="small"
                exclusive
                value={endpointMode}
                onChange={(_, next) => {
                  if (next) setEndpointMode(next);
                }}
                aria-label="endpoint mode"
              >
                <ToggleButton
                  value="chat-completions"
                  aria-label="chat completions"
                >
                  Chat Completions
                </ToggleButton>
                <ToggleButton value="responses" aria-label="responses">
                  Responses
                </ToggleButton>
              </ToggleButtonGroup>
              <FormGroup>
                <FormControlLabel
                  control={
                    <Switch
                      checked={stream}
                      onChange={(event) => {
                        setStream(event.target.checked);
                      }}
                      // Responses path is streaming-only in Phase 1.
                      disabled={endpointMode === 'responses'}
                    />
                  }
                  label="Streaming"
                />
              </FormGroup>
              <FormGroup>
                <FormControlLabel
                  control={
                    <Switch
                      checked={webSearch}
                      onChange={(event) => setWebSearch(event.target.checked)}
                    />
                  }
                  label="Web search"
                />
              </FormGroup>
            </Box>
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
                endpointMode={endpointMode}
                webSearch={webSearch}
              />
            )}
          </Grid>
        </Grid>
      </Drawer>
    </>
  );
}
