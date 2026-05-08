import Box from '@mui/material/Box';
import type { SxProps } from '@mui/material/styles';

export type AppContainerProps = {
  children: React.ReactNode;
  sx?: SxProps;
};

/**
 * The hairline-bordered, paper-filled frame used to wrap most
 * top-level page bodies (Audit, Pricing, Roles, AI Resource edit,
 * Playground, …). One source of truth so the border weight/colour
 * and corner radius stay aligned with the Vercel-vibe theme tokens.
 */
export default function AppContainer({ children, sx }: AppContainerProps) {
  return (
    <Box
      sx={{
        p: 3,
        backgroundColor: 'var(--mui-palette-background-paper)',
        border: '1px solid var(--mui-palette-divider)',
        borderRadius: 1,
        ...(sx || {}),
      }}
    >
      {children}
    </Box>
  );
}
