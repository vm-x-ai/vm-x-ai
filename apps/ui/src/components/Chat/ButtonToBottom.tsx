'use client';

import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import React from 'react';

export default function ButtonToBottom({
  isAtBottom,
  scrollToBottom,
}: {
  isAtBottom: boolean;
  scrollToBottom: () => void;
}) {
  return (
    <Box
      sx={{
        position: 'relative',
      }}
    >
      <Box
        sx={{
          position: 'absolute',
          right: '40%',
          top: '-40px',
        }}
      >
        {!isAtBottom && (
          <Chip
            size="small"
            label="scroll to bottom"
            color="primary"
            icon={<KeyboardArrowDownIcon />}
            onClick={scrollToBottom}
          />
        )}
      </Box>
    </Box>
  );
}
