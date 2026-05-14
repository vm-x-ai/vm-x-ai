'use client';

import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import PsychologyIcon from '@mui/icons-material/Psychology';
import React, { useEffect, useRef, useState } from 'react';
import BaseMessage from './BaseMessage';
import VMXIcon from '../Providers/Icons/VMX';
import ProviderLogo from '../Providers/ProviderLogo';
import type { AiProviderLogoDto } from '@/clients/api';

export type BotMessageReasoning = {
  text: string;
  /** True while the reasoning stream is still emitting deltas. */
  streaming: boolean;
};

export type BotMessageProps = {
  content: string;
  modelLogo?: AiProviderLogoDto | null;
  model?: string;
  /**
   * Streamed or batched reasoning content (model thinking text).
   * Rendered in a collapsed Accordion above the reply when present.
   * Pass `null` when the reply carries no reasoning surface
   * (non-reasoning model or upstream didn't return summaries).
   */
  reasoning?: BotMessageReasoning | null;
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
  reasoning,
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

  // Auto-toggle the accordion across the streaming → done transition:
  // expand while the model is thinking, collapse the moment streaming
  // ends so the finished answer is the primary surface. The user can
  // still toggle manually afterwards via `onChange`. A ref guards the
  // post-stream collapse from re-firing on every render once the
  // user has manually opened the section again.
  const [expanded, setExpanded] = useState(reasoning?.streaming ?? false);
  const wasStreamingRef = useRef(reasoning?.streaming ?? false);
  useEffect(() => {
    const isStreaming = reasoning?.streaming ?? false;
    if (wasStreamingRef.current && !isStreaming) {
      setExpanded(false);
    } else if (!wasStreamingRef.current && isStreaming) {
      setExpanded(true);
    }
    wasStreamingRef.current = isStreaming;
  }, [reasoning?.streaming]);

  const reasoningBlock =
    reasoning && reasoning.text.length > 0 ? (
      <Accordion
        disableGutters
        elevation={0}
        expanded={expanded}
        onChange={(_, isExpanded) => setExpanded(isExpanded)}
        // The reasoning trace sits above the reply (it's the model's
        // pre-answer thinking). `mb` separates it from the answer
        // below; no top margin because the avatar/secondary line
        // already provides spacing above.
        sx={{
          mb: 1,
          backgroundColor: 'action.hover',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1,
          '&:before': { display: 'none' },
        }}
      >
        <AccordionSummary
          expandIcon={<ExpandMoreIcon fontSize="small" />}
          sx={{ minHeight: 32, '& .MuiAccordionSummary-content': { my: 0.5 } }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <PsychologyIcon fontSize="small" />
            <Typography variant="caption" sx={{ fontWeight: 500 }}>
              {reasoning.streaming ? 'Thinking…' : 'Thought'}
            </Typography>
          </Box>
        </AccordionSummary>
        <AccordionDetails sx={{ pt: 0 }}>
          <Typography
            variant="body2"
            component="pre"
            sx={{
              whiteSpace: 'pre-wrap',
              fontFamily: 'inherit',
              m: 0,
              color: 'text.secondary',
            }}
          >
            {reasoning.text}
          </Typography>
        </AccordionDetails>
      </Accordion>
    ) : null;

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
      extraContent={reasoningBlock}
    />
  );
}
