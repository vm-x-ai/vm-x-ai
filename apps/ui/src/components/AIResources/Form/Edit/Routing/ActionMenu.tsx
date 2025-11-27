'use client';

import DeleteIcon from '@mui/icons-material/Delete';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import ToggleOffIcon from '@mui/icons-material/ToggleOff';
import ToggleOnIcon from '@mui/icons-material/ToggleOn';
import Box from '@mui/material/Box';
import { grey } from '@mui/material/colors';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import Typography from '@mui/material/Typography';
import React from 'react';

export type ActionMenuProps = {
  onDelete: () => void;
  onAdvancedEdit: () => void;
  advancedEditing: boolean;
  menuAnchorEl: HTMLElement | null;
  setMenuAnchorEl: (anchor: HTMLElement | null) => void;
};

export default function ActionMenu({
  onDelete,
  onAdvancedEdit,
  advancedEditing,
  menuAnchorEl,
  setMenuAnchorEl,
}: ActionMenuProps) {
  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    setMenuAnchorEl(event.currentTarget);
  };

  const handleCloseMenu = () => {
    setMenuAnchorEl(null); // Close the menu by clearing anchor
  };

  return (
    <>
      <IconButton
        size="small"
        onClick={(event) => {
          event.stopPropagation();
          handleMenuOpen(event);
        }}
      >
        <MoreHorizIcon />
      </IconButton>
      <Menu
        anchorEl={menuAnchorEl}
        open={Boolean(menuAnchorEl)}
        onClose={handleCloseMenu}
        sx={{
          mt: '0.5em',
          '& .MuiPaper-root': {
            transformOrigin: 'top right',
          },
        }}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'right',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'right',
        }}
      >
        <Box sx={{ p: 1, width: 200 }}>
          <Grid
            container
            alignItems="center"
            onClick={() => {
              onDelete();
              handleCloseMenu();
            }}
            sx={{
              cursor: 'pointer',
              mb: 1,
              '&:hover': { backgroundColor: grey[200] },
            }}
          >
            <Grid display="flex" alignItems="center">
              <DeleteIcon sx={{ color: grey[700], mr: 1 }} />
              <Typography color={grey[700]}>Delete this route</Typography>
            </Grid>
          </Grid>
          <Grid
            container
            alignItems="center"
            onClick={() => {
              onAdvancedEdit();
              handleCloseMenu();
            }}
            sx={{
              cursor: 'pointer',
              '&:hover': { backgroundColor: grey[200] },
            }}
          >
            <Grid display="flex" alignItems="center">
              {advancedEditing ? (
                <ToggleOnIcon sx={{ color: grey[700], mr: 1 }} />
              ) : (
                <ToggleOffIcon sx={{ color: grey[700], mr: 1 }} />
              )}
              <Typography color={grey[700]}>
                {advancedEditing ? 'Advanced edit ON' + '\u00A0' : 'Advanced edit OFF'}
              </Typography>
            </Grid>
          </Grid>
        </Box>
      </Menu>
    </>
  );
}
