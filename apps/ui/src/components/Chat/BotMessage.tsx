'use client';

import Avatar from '@mui/material/Avatar';
import Image from 'next/image';
import React from 'react';
import BaseMessage from './BaseMessage';
import VMXIcon from '../Providers/Icons/VMX';

export type BotMessageProps = {
  content: string;
  modelIconUrl?: string;
  model?: string;
};

export default function BotMessage({
  content,
  model,
  modelIconUrl,
}: BotMessageProps) {
  return (
    <BaseMessage
      avatar={
        <Avatar
          alt="AI"
          sx={{
            bgcolor: 'white',
            border: '.1rem solid var(--mui-palette-divider)',
          }}
          variant="rounded"
        >
          {modelIconUrl ? (
            <Image
              alt={model ?? ''}
              src={modelIconUrl}
              height={20}
              width={20}
            />
          ) : (
            <VMXIcon width={20} height={20} />
          )}
        </Avatar>
      }
      content={content}
      secondaryContent={model}
    />
  );
}
