'use client';

import SendIcon from '@mui/icons-material/Send';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import CloseIcon from '@mui/icons-material/Close';
import ImageIcon from '@mui/icons-material/Image';
import AudiotrackIcon from '@mui/icons-material/Audiotrack';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import React, { useCallback, useRef, useState } from 'react';
import { useEnterSubmit } from '@/hooks/use-enter-submit';
import ChatPanel from './ChatPanel';
import ClearHistoryButton from './ClearHistoryButton';
import { AiProviderDto, AiResourceEntity } from '@/clients/api';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { ChatMessage } from './types';
import Button from '@mui/material/Button';
import { useResponsesStream } from './useResponsesStream';
import { useAnthropicStream } from './useAnthropicStream';

export type ChatEndpointMode = 'chat-completions' | 'responses' | 'anthropic';

export type ChatProps = {
  resource: AiResourceEntity;
  providersMap: Record<string, AiProviderDto>;
  workspaceId?: string;
  environmentId?: string;
  height?: number | string;
  stream?: boolean;
  /**
   * Which gateway endpoint to drive. `chat-completions` (default) goes
   * through `/api/chat` + the Vercel AI SDK; `responses` goes through the
   * new `/api/responses` BFF and the `useResponsesStream` hook.
   */
  endpointMode?: ChatEndpointMode;
  /**
   * Enable web-search passthrough on the gateway. The BFF translates this
   * to the right shape per endpoint:
   *   - Chat Completions: `web_search_options: {}` (OpenAI/Perplexity)
   *   - Responses API: `tools: [{ type: 'web_search_preview' }]`
   * Providers that don't recognize the field ignore it.
   */
  webSearch?: boolean;
  padding?: number;
  elevation?: number;
  /**
   * Caller-side gateway envelope, forwarded verbatim to the BFF
   * (which spreads it into the `vmx` envelope on the upstream call).
   * Lets the playground exercise per-request correlation IDs,
   * caller metadata, and per-resource overrides without leaving the
   * OIDC-authenticated session.
   *
   * `extraResourceOverrides` is shallow-merged on top of the base
   * `resource` (which the gateway already treats as the resource
   * config override). Anything the caller sets wins; anything they
   * omit stays as-configured.
   */
  correlationId?: string;
  metadata?: Record<string, string>;
  extraResourceOverrides?: Partial<AiResourceEntity>;
  /**
   * Callback fired when the user clicks the "view audit details"
   * button on a bot reply. The argument is the gateway-assigned
   * request id of that reply (`x-vmx-request-id`). The playground
   * uses this to open an in-page audit-detail drawer; other chat
   * surfaces leave it undefined and the affordance doesn't render.
   */
  onOpenAudit?: (requestId: string) => void;
};

/**
 * Soft cap matching the BFF + Fastify body limits (100 MB). Anything
 * larger gets rejected client-side with a clear error so the user
 * doesn't waste a round-trip on a request the gateway will refuse.
 */
const MAX_TOTAL_ATTACHMENT_BYTES = 100 * 1024 * 1024;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function attachmentIcon(file: File): React.ReactNode {
  if (file.type.startsWith('image/')) return <ImageIcon fontSize="small" />;
  if (file.type.startsWith('audio/'))
    return <AudiotrackIcon fontSize="small" />;
  return <InsertDriveFileIcon fontSize="small" />;
}

export default function Chat({
  resource,
  providersMap,
  workspaceId,
  environmentId,
  height,
  stream = true,
  endpointMode = 'chat-completions',
  webSearch = false,
  padding = 2,
  elevation = 3,
  correlationId,
  metadata,
  extraResourceOverrides,
  onOpenAudit,
}: ChatProps) {
  const [input, setInput] = useState('');
  // Attachments are kept as `File` objects until send-time. The AI SDK
  // serialises them to data-URL parts on the request; the BFF forwards
  // them as-is so the gateway can pass them to OpenAI's
  // `image_url` / `input_audio` / `file` content types.
  const [attachments, setAttachments] = useState<File[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Always call both hooks (rule of hooks); only the active branch's
  // sendMessage gets driven from the form. Inactive hook is essentially
  // idle — no network traffic until something calls its sendMessage.
  const chatCompletions = useChat<ChatMessage>({
    transport: new DefaultChatTransport({
      api: '/api/chat',
      prepareSendMessagesRequest: ({ messages, body }) => {
        return {
          body: {
            messages: messages,
            workspaceId,
            environmentId,
            ...body,
          },
        };
      },
    }),
    experimental_throttle: 50,
  });
  const responsesChat = useResponsesStream({ workspaceId, environmentId });
  const anthropicChat = useAnthropicStream({ workspaceId, environmentId });

  const { messages, error, setMessages, status } =
    endpointMode === 'responses'
      ? responsesChat
      : endpointMode === 'anthropic'
      ? anthropicChat
      : {
          messages: chatCompletions.messages,
          setMessages: chatCompletions.setMessages,
          status: chatCompletions.status,
          error: chatCompletions.error,
        };
  const { formRef, onKeyDown } = useEnterSubmit();

  const addFiles = useCallback((incoming: File[]) => {
    if (incoming.length === 0) return;
    setAttachments((prev) => {
      const next = [...prev, ...incoming];
      const total = next.reduce((acc, f) => acc + f.size, 0);
      if (total > MAX_TOTAL_ATTACHMENT_BYTES) {
        setAttachmentError(
          `Attachments total ${formatBytes(
            total
          )} exceeds the 100 MB limit. Remove one or split the request.`
        );
        return prev;
      }
      setAttachmentError(null);
      return next;
    });
  }, []);

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
    setAttachmentError(null);
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement> | undefined) {
    e?.preventDefault();
    const value = input.trim();
    if (!value && attachments.length === 0) return;
    // Snapshot text + files, but leave the input visible until the
    // request actually starts streaming. `useChat.sendMessage` resolves
    // either when the SDK kicks off the network call or when it
    // throws, so by the time we hit the finally block the user
    // sees the result either way. Clearing on success only avoids
    // the "I lost my attachments on a transient network error" case.
    const text = value;
    const filesToSend = attachments;
    setInput('');
    setAttachmentError(null);
    try {
      // The AI SDK's `useChat.sendMessage` accepts `{ text, files }`; it
      // converts each File to a data-URL `FileUIPart` automatically.
      // The Responses-API and Anthropic paths don't currently surface
      // a `files` argument; attachments only flow through chat-completions.
      // Shallow-merge the playground-supplied override JSON on top of
      // the base resource. `vmx.resourceConfigOverrides` on the gateway
      // does the same shallow merge — extra keys win, omitted ones
      // stay as-configured.
      const mergedOverrides = {
        ...resource,
        ...(extraResourceOverrides ?? {}),
      };
      const envelope = {
        ...(correlationId ? { correlationId } : {}),
        ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
      };
      if (endpointMode === 'responses') {
        await responsesChat.sendMessage(
          { text },
          {
            body: {
              resourceConfigOverrides: mergedOverrides,
              webSearch,
              ...envelope,
            },
          }
        );
      } else if (endpointMode === 'anthropic') {
        await anthropicChat.sendMessage(
          { text },
          {
            body: {
              resourceConfigOverrides: mergedOverrides,
              ...envelope,
            },
          }
        );
      } else if (filesToSend.length > 0) {
        // The AI SDK accepts a `FileList`; we build one from the array
        // using `DataTransfer` (a browser-only API — `Chat.tsx` is a
        // client component, so it's safe).
        const dt = new DataTransfer();
        for (const f of filesToSend) dt.items.add(f);
        await chatCompletions.sendMessage(
          { text, files: dt.files },
          {
            body: {
              resourceConfigOverrides: mergedOverrides,
              webSearch,
              ...envelope,
            },
          }
        );
      } else {
        await chatCompletions.sendMessage(
          { text },
          {
            body: {
              resourceConfigOverrides: mergedOverrides,
              webSearch,
              ...envelope,
            },
          }
        );
      }
      // Clear attachments only on success — keep them on failure so the
      // user can retry without re-attaching.
      setAttachments([]);
    } catch (err) {
      // Re-show the input the user typed so they can retry; useChat
      // surfaces the network error in `error` state, ChatPanel
      // renders it. We swallow here to avoid an unhandled rejection.
      setInput(text);
      console.error('Chat send failed:', err);
    }
  }

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLDivElement | HTMLTextAreaElement>) => {
      const pasted: File[] = [];
      for (const item of Array.from(e.clipboardData?.items ?? [])) {
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file) pasted.push(file);
        }
      }
      if (pasted.length > 0) addFiles(pasted);
    },
    [addFiles]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      const dropped = Array.from(e.dataTransfer.files);
      if (dropped.length > 0) addFiles(dropped);
    },
    [addFiles]
  );

  return (
    <Box
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={(e) => {
        // Only flip the flag when leaving the outermost wrapper, not
        // when crossing internal child boundaries.
        if (e.currentTarget === e.target) setIsDragging(false);
      }}
      onDrop={handleDrop}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        height: height ?? '100vh',
        padding: padding,
        position: 'relative',
        outline: isDragging ? '2px dashed' : 'none',
        outlineColor: 'primary.main',
        outlineOffset: '-8px',
        backgroundColor: isDragging ? 'action.hover' : undefined,
        transition: 'background-color 120ms',
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
                overrides={resource}
                messages={messages}
                error={error}
                width="100%"
                height={height}
                elevation={elevation}
                isGenerating={status === 'submitted'}
                onOpenAudit={onOpenAudit}
              />
            </Box>

            <Paper
              variant="outlined"
              sx={{
                padding: 2,
                mt: 1,
                // Outlined matches the chat panel above + the rest of
                // the app's hairline-bordered surfaces (AppContainer,
                // dropdowns, accordion) instead of stacking elevation
                // shadows.
              }}
              elevation={elevation}
            >
              <ClearHistoryButton
                messages={messages}
                onClearHistory={() => setMessages([])}
              />
              {attachments.length > 0 && (
                <Box
                  sx={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 1,
                    mb: 1,
                  }}
                >
                  {attachments.map((file, idx) => (
                    <Box
                      key={`${file.name}-${idx}`}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.5,
                        px: 1,
                        py: 0.5,
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: 1,
                        fontSize: '0.85rem',
                        backgroundColor: 'background.paper',
                      }}
                    >
                      {attachmentIcon(file)}
                      <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                        <Typography
                          variant="caption"
                          noWrap
                          sx={{ maxWidth: 200 }}
                        >
                          {file.name}
                        </Typography>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ fontSize: '0.7rem' }}
                        >
                          {formatBytes(file.size)}
                        </Typography>
                      </Box>
                      <IconButton
                        size="small"
                        aria-label={`Remove ${file.name}`}
                        onClick={() => removeAttachment(idx)}
                      >
                        <CloseIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  ))}
                </Box>
              )}
              {attachmentError && (
                <Typography
                  variant="caption"
                  color="error"
                  sx={{ display: 'block', mb: 1 }}
                >
                  {attachmentError}
                </Typography>
              )}
              <form onSubmit={handleSubmit} ref={formRef}>
                <Box sx={{ display: 'flex', alignItems: 'flex-start' }}>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="image/*,audio/*,*/*"
                    style={{ display: 'none' }}
                    aria-label="Attach files"
                    onChange={(e) => {
                      addFiles(Array.from(e.target.files ?? []));
                      // Reset so re-selecting the same file fires onChange.
                      e.target.value = '';
                    }}
                  />
                  <Tooltip title="Attach images, audio, or files (paste or drag/drop also works)">
                    <IconButton
                      aria-label="Attach files"
                      size="small"
                      onClick={() => fileInputRef.current?.click()}
                      sx={{ mr: 1, mt: 0.5 }}
                    >
                      <AttachFileIcon />
                    </IconButton>
                  </Tooltip>
                  <TextField
                    fullWidth
                    variant="outlined"
                    value={input}
                    multiline
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={onKeyDown}
                    onPaste={handlePaste}
                    placeholder="Type a message... (Press Shift + Enter to break line)"
                  />
                  <Button
                    type="submit"
                    variant="contained"
                    color="primary"
                    sx={{ ml: 2 }}
                    disabled={input === '' && attachments.length === 0}
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
