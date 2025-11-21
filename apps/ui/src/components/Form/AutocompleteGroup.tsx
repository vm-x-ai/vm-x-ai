import { styled, lighten, darken } from '@mui/material/styles';

export const GroupHeader: React.FC<React.HTMLAttributes<HTMLDivElement>> =
  styled('div')(({ theme }) => ({
    display: 'flex',
    gap: '0.5rem',
    position: 'sticky',
    top: '-8px',
    padding: '4px 10px',
    color: theme.palette.primary.main,
    backgroundColor:
      theme.palette.mode === 'light'
        ? lighten(theme.palette.primary.light, 0.85)
        : darken(theme.palette.primary.main, 0.8),
  }));

export const GroupItems: React.FC<React.HTMLAttributes<HTMLUListElement>> =
  styled('ul')({
    padding: 0,
  });
