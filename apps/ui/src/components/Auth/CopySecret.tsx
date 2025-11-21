'use client';

import {
  Check as CheckIcon,
  ContentCopy as ContentCopyIcon,
} from '@mui/icons-material';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import { useState } from 'react';

export type CopySecretProps = {
  value: string;
};

export default function CopySecret({ value }: CopySecretProps) {
  const [pulse, setPulse] = useState(false);

  return (
    <Typography variant="body2">
      <strong>{value}</strong>
      <IconButton
        aria-label="copy to clipboard"
        size="small"
        sx={{
          marginLeft: '0.2rem',
        }}
        onClick={() => {
          navigator.clipboard.writeText(value);
          setPulse(true);
          setTimeout(() => {
            setPulse(false);
          }, 2000);
        }}
      >
        {pulse ? (
          <CheckIcon color="success" fontSize="inherit" />
        ) : (
          <ContentCopyIcon fontSize="inherit" />
        )}
      </IconButton>
    </Typography>
  );
}
