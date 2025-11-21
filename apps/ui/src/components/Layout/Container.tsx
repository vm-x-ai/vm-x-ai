import Box from '@mui/material/Box';
import type { SxProps } from '@mui/material/styles';

export type AppContainerProps = {
  children: React.ReactNode;
  sx?: SxProps;
};

export default function AppContainer({ children, sx }: AppContainerProps) {
  return (
    <Box
      sx={{
        p: 3,
        backgroundColor: 'var(--mui-palette-background-paper)',
        border: '.1rem solid var(--mui-palette-divider)',
        ...(sx || {}),
      }}
    >
      {children}
    </Box>
  );
}
