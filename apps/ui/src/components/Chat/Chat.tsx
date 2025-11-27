'use client';

import SendIcon from '@mui/icons-material/Send';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import React, { useEffect, useState } from 'react';
import { useEnterSubmit } from '@/hooks/use-enter-submit';
import ChatPanel from './ChatPanel';
import ClearHistoryButton from './ClearHistoryButton';
import { AiProviderDto, AiResourceEntity } from '@/clients/api';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { ChatMessage } from './types';
import Button from '@mui/material/Button';

export type ChatProps = {
  resource: AiResourceEntity;
  providersMap: Record<string, AiProviderDto>;
  workspaceId?: string;
  environmentId?: string;
  height?: number | string;
  stream?: boolean;
  padding?: number;
  elevation?: number;
};

export default function Chat({
  resource,
  providersMap,
  workspaceId,
  environmentId,
  height,
  stream = true,
  padding = 2,
  elevation = 3,
}: ChatProps) {
  const [resourceConfigOverrides, setResourceConfigOverrides] = useState<
    Partial<AiResourceEntity>
  >({
    ...resource,
    useFallback: true,
  });
  const [input, setInput] = useState('');
  const { messages, sendMessage, error, setMessages, status } =
    useChat<ChatMessage>({
      transport: new DefaultChatTransport({
        api: '/api/chat',
        prepareSendMessagesRequest: ({ messages }) => {
          return {
            body: {
              messages: messages,
              workspaceId,
              environmentId,
              resourceConfigOverrides,
            },
          };
        },
      }),
      // Throttle the messages and data updates to 50ms:
      experimental_throttle: 50,
    });
  const { formRef, onKeyDown } = useEnterSubmit();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement> | undefined) {
    e?.preventDefault();

    const value = input.trim();
    setInput('');
    if (!value) return;

    sendMessage({
      text: value,
    });
  }

  useEffect(() => {
    setResourceConfigOverrides({
      ...resource,
      useFallback: true,
    });
  }, [resource]);

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        height: height ?? '100vh',
        padding: padding,
      }}
    >
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 12 }}>
          <Box
            sx={{
              display: 'flex',
              width: '100%',
              flexDirection: 'column',
            }}
          >
            <Box
              sx={{
                display: 'flex',
                width: '100%',
              }}
            >
              <ChatPanel
                providersMap={providersMap}
                overrides={resourceConfigOverrides}
                messages={messages}
                error={error}
                width="100%"
                height={height}
                elevation={elevation}
                isGenerating={status === 'submitted'}
              />
            </Box>

            <Paper
              sx={{
                padding: 2,
                margin: 1,
              }}
              elevation={elevation}
            >
              <ClearHistoryButton
                messages={messages}
                onClearHistory={() => setMessages([])}
              />
              <form onSubmit={handleSubmit} ref={formRef}>
                <Box sx={{ display: 'flex' }}>
                  <TextField
                    fullWidth
                    variant="outlined"
                    value={input}
                    multiline
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={onKeyDown}
                    placeholder="Type a message... (Press Shift + Enter to break line)"
                  />
                  <Button
                    type="submit"
                    variant="contained"
                    color="primary"
                    sx={{ ml: 2 }}
                    disabled={input === ''}
                    loading={status === 'submitted' || status === 'streaming'}
                    loadingPosition="end"
                    endIcon={<SendIcon />}
                  >
                    Send
                  </Button>
                </Box>
              </form>
            </Paper>
          </Box>
        </Grid>
      </Grid>
    </Box>
  );
}
