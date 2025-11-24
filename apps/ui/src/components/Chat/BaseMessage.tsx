'use client';

import Box from '@mui/material/Box';
import ListItem from '@mui/material/ListItem';
import ListItemAvatar from '@mui/material/ListItemAvatar';
import ListItemText from '@mui/material/ListItemText';
import Markdown from '@/components/Markdown';
import React from 'react';

export type BaseMessageProps = {
  avatar: React.ReactNode;
  content: string;
  secondaryContent?: string | React.ReactNode;
};

export default function BaseMessage({ avatar, content, secondaryContent }: BaseMessageProps) {
  return (
    <ListItem>
      <ListItemAvatar
        sx={{
          alignSelf: 'flex-start',
        }}
      >
        {avatar}
      </ListItemAvatar>
      <ListItemText
        primary={
          <Box sx={{ width: '100%' }}>
            <Markdown>{content}</Markdown>
          </Box>
        }
        secondary={secondaryContent}
      />
    </ListItem>
  );
}
