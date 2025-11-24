'use client';

import HistoryIcon from '@mui/icons-material/History';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import { UIMessage } from 'ai';
import React from 'react';

export type ClearHistoryButtonProps = {
  messages: UIMessage<{ model: string }>[];
  onClearHistory: () => void;
};

export default function ClearHistoryButton({
  messages,
  onClearHistory,
}: ClearHistoryButtonProps) {
  if (messages.length === 0) {
    return <></>;
  }

  return (
    <Box
      sx={{
        position: 'relative',
      }}
    >
      <Box
        sx={{
          position: 'absolute',
          right: '0',
          top: '-70px',
        }}
      >
        <Chip
          size="small"
          label="clear history"
          color="primary"
          icon={<HistoryIcon />}
          onClick={() => {
            onClearHistory();
          }}
        />
      </Box>
    </Box>
  );
}
