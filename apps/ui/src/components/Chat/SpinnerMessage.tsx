'use client';

import Avatar from '@mui/material/Avatar';
import ListItem from '@mui/material/ListItem';
import ListItemAvatar from '@mui/material/ListItemAvatar';
import ListItemText from '@mui/material/ListItemText';
import React from 'react';
import { BeatLoader } from 'react-spinners';
import VMXIcon from '@/components/Providers/Icons/VMX';

export default function SpinnerMessage() {
  return (
    <ListItem>
      <ListItemAvatar
        sx={{
          alignSelf: 'flex-start',
        }}
      >
        <Avatar alt="AI" sx={{ bgcolor: 'white', border: '.1rem solid var(--mui-palette-divider)' }} variant="rounded">
          <VMXIcon width={28} height={28} />
        </Avatar>
      </ListItemAvatar>
      <ListItemText primary={<BeatLoader color="var(--mui-palette-primary-main)" size={10} />} />
    </ListItem>
  );
}
