'use client';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import List from '@mui/material/List';
import Paper from '@mui/material/Paper';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useScrollAnchor } from '@/hooks/use-scroll-anchor';
import Image from 'next/image';
import React, { useMemo } from 'react';
import ButtonToBottom from './ButtonToBottom';
import {
  AiProviderDto,
  AiResourceEntity,
  AiResourceModelConfigEntity,
} from '@/clients/api';
import UserMessage from './UserMessage';
import BotMessage from './BotMessage';
import { ChatMessage } from './types';
import SpinnerMessage from './SpinnerMessage';

export type ChatPanelProps = {
  messages: ChatMessage[];
  error?: Error | null;
  width?: number | string;
  overrides: Partial<AiResourceEntity>;
  providersMap: Record<string, AiProviderDto>;
  height?: number | string;
  elevation?: number;
  isGenerating?: boolean;
};

export default function ChatPanel({
  messages,
  error,
  width,
  providersMap,
  overrides,
  height,
  elevation = 3,
  isGenerating = true,
}: ChatPanelProps) {
  const theme = useTheme();
  const isMd = useMediaQuery(theme.breakpoints.up('md'));
  const { messagesRef, scrollRef, isAtBottom, visibilityRef, scrollToBottom } =
    useScrollAnchor();

  const models = useMemo(
    () =>
      Object.values(
        [
          ...(overrides.model ? [overrides.model] : []),
          ...(overrides.fallbackModels ?? []),
          ...(overrides.routing?.conditions
            ?.filter((condition) => condition.enabled)
            .map((c) => c.then) ?? []),
        ].reduce((acc, cur) => {
          if (cur && acc[cur.model]) return acc;

          if (cur) {
            acc[cur.model] = cur;
          }
          return acc;
        }, {} as Record<string, AiResourceModelConfigEntity>)
      ),
    [overrides.fallbackModels, overrides.model, overrides.routing?.conditions]
  );

  return (
    <>
      <Paper
        sx={{
          width,
          padding: 2,
          margin: 1,
        }}
        elevation={elevation}
      >
        <Box
          sx={{
            display: 'block',
            height: isMd ? `calc(${height ?? '100vh'} - 12rem)` : '55vh',
            overflowY: 'auto',
            mb: 2,
          }}
          ref={scrollRef}
        >
          <div ref={messagesRef}>
            <Box
              sx={{
                display: 'flex',
                width: '100%',
                flexDirection: 'column',
              }}
            >
              <Box
                sx={{
                  width: '100%',
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '5px',
                }}
              >
                {models.map((model) => (
                  <Chip
                    key={model.model}
                    label={model?.model}
                    size="small"
                    icon={
                      <Box>
                        <Image
                          alt={model.model}
                          src={providersMap[model.provider].config.logo.url}
                          height={18}
                          width={18}
                        />
                      </Box>
                    }
                  />
                ))}
              </Box>
              <Divider
                sx={{
                  marginTop: 1,
                  marginBottom: 1,
                }}
              />
              <Box
                sx={{
                  display: 'flex',
                  width: '100%',
                }}
              >
                <List
                  sx={{
                    width: '100%',
                  }}
                >
                  {messages.map((m, index) => (
                    <React.Fragment key={m.id ?? index}>
                      <Message message={m} providersMap={providersMap} />
                      {index !== messages.length - 1 && (
                        <Divider variant="inset" component="li" />
                      )}
                    </React.Fragment>
                  ))}
                  {isGenerating && <SpinnerMessage />}
                  {error && <Alert severity="error">{error.message}</Alert>}
                </List>
              </Box>
            </Box>
            {messages.length > 0 && (
              <div
                style={{
                  width: '100%',
                  height: '1px',
                }}
                ref={visibilityRef}
              />
            )}
          </div>
        </Box>

        <ButtonToBottom
          isAtBottom={isAtBottom}
          scrollToBottom={scrollToBottom}
        />
      </Paper>
    </>
  );
}

type MessageProps = {
  message: ChatMessage;
  providersMap: Record<string, AiProviderDto>;
};

function Message({ message, providersMap }: MessageProps) {
  const content = useMemo(
    () =>
      message.parts
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join(''),
    [message.parts]
  );

  if (message.role === 'user') {
    return <UserMessage content={content} />;
  }

  return (
    <BotMessage
      content={content}
      model={message.metadata?.model}
      modelIconUrl={
        providersMap[message.metadata?.provider ?? '']?.config?.logo?.url
      }
    />
  );
}
