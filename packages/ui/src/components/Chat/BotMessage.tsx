'use client';

import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import React from 'react';
import BaseMessage from './BaseMessage';
import VMXIcon from '../Providers/Icons/VMX';
import ProviderLogo from '../Providers/ProviderLogo';
import type { AiProviderLogoDto } from '@/clients/api';

export type BotMessageProps = {
  content: string;
  modelLogo?: AiProviderLogoDto | null;
  model?: string;
  /**
   * When set, the bot message renders a small "view audit details"
   * button next to the model label that fires this callback. The
   * playground uses it to open an in-page audit-detail drawer for the
   * underlying request id without navigating away from the chat.
   * Other chat surfaces leave it undefined.
   */
  onOpenAudit?: () => void;
};

export default function BotMessage({
  content,
  model,
  modelLogo,
  onOpenAudit,
}: BotMessageProps) {
  const secondary = onOpenAudit ? (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
      }}
    >
      <span>{model}</span>
      <Tooltip title="View audit details">
        <IconButton
          onClick={onOpenAudit}
          size="small"
          aria-label="View audit details for this reply"
          sx={{ p: 0.25 }}
        >
          <OpenInNewIcon sx={{ fontSize: 14 }} />
        </IconButton>
      </Tooltip>
    </Box>
  ) : (
    model
  );

  return (
    <BaseMessage
      avatar={
        <Avatar
          alt="AI"
          sx={{
            // `background.default` resolves to the CSS variable that
            // flips with the active colour scheme (white in light,
            // near-black in dark). Hardcoding `white` left the white
            // `darkUrl` logo variants (OpenAI, Perplexity) invisible
            // against a white avatar in dark mode.
            bgcolor: 'background.default',
            border: '.1rem solid var(--mui-palette-divider)',
          }}
          variant="rounded"
        >
          {modelLogo ? (
            <ProviderLogo
              alt={model ?? ''}
              logo={modelLogo}
              height={20}
              width={20}
            />
          ) : (
            <VMXIcon width={20} height={20} />
          )}
        </Avatar>
      }
      content={content}
      secondaryContent={secondary}
    />
  );
}
