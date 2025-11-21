'use client';

import { Logout as LogoutIcon } from '@mui/icons-material';
import KeyIcon from '@mui/icons-material/Key';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { signOutAction } from './actions';
import { stringToColor } from '@/utils/color';
import { User } from 'next-auth';

function stringAvatar(name: string) {
  if (!name) {
    return {
      children: 'NA',
    };
  }

  return {
    sx: {
      bgcolor: stringToColor(name),
    },
    children: `${name.split(' ')[0][0]}${name.split(' ')[1]?.[0] ?? ''}`,
  };
}

export type AccountMenuProps = {
  user?: User;
};

export default function AccountMenu({ user }: AccountMenuProps) {
  const [isPending, startTransition] = useTransition();

  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);
  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };
  const handleClose = () => {
    setAnchorEl(null);
  };

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', textAlign: 'center' }}>
        <Tooltip title="Account settings">
          <IconButton
            onClick={handleClick}
            size="small"
            sx={{ ml: 2 }}
            aria-controls={open ? 'account-menu' : undefined}
            aria-haspopup="true"
            aria-expanded={open ? 'true' : undefined}
          >
            <Avatar
              {...(user?.image
                ? { src: user?.image }
                : stringAvatar(user?.name || ''))}
            />
          </IconButton>
        </Tooltip>
      </Box>
      <Menu
        anchorEl={anchorEl}
        id="account-menu"
        open={open}
        onClose={handleClose}
        onClick={handleClose}
        PaperProps={{
          elevation: 0,
          sx: {
            overflow: 'visible',
            filter: 'drop-shadow(0px 2px 8px rgba(0,0,0,0.32))',
            mt: 1.5,
            '& .MuiAvatar-root': {
              width: 32,
              height: 32,
              ml: -0.5,
              mr: 1,
            },
            '&::before': {
              content: '""',
              display: 'block',
              position: 'absolute',
              top: 0,
              right: 14,
              width: 10,
              height: 10,
              bgcolor: 'background.paper',
              transform: 'translateY(-50%) rotate(45deg)',
              zIndex: 0,
            },
          },
        }}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
      >
        {user && [
          <MenuItem key="user" onClick={handleClose}>
            <Avatar />{' '}
            <Box>
              <Typography variant="body1">{user?.name}</Typography>
              <Typography variant="caption">{user?.email}</Typography>
            </Box>
          </MenuItem>,
          <Divider key="divider-1" />,
          <MenuItem key="user-profile" component={Link} href="/account/profile">
            <ListItemIcon>
              <KeyIcon fontSize="small" />
            </ListItemIcon>
            Personal Access Tokens
          </MenuItem>,
          <Divider key="divider-2" />,
        ]}
        <MenuItem
          onClick={async (event) => {
            event.stopPropagation();
            startTransition(async () => {
              await signOutAction();
            });
          }}
          disabled={isPending}
        >
          <ListItemIcon>
            <LogoutIcon fontSize="small" />
          </ListItemIcon>
          {isPending ? 'Logging you out...' : 'Logout'}
        </MenuItem>
      </Menu>
    </>
  );
}
