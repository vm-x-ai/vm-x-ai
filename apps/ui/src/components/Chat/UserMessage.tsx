'use client';

import PersonIcon from '@mui/icons-material/Person';
import Avatar from '@mui/material/Avatar';
import React from 'react';
import BaseMessage from './BaseMessage';

export type UserMessageProps = {
  content: string;
};

export default function UserMessage({ content }: UserMessageProps) {
  return (
    <BaseMessage
      avatar={
        <Avatar alt="User" sx={{ bgcolor: 'var(--mui-palette-primary-main)' }} variant="rounded">
          <PersonIcon />
        </Avatar>
      }
      content={content}
    />
  );
}
