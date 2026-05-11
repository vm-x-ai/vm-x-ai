'use client';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import type { SxProps, Theme } from '@mui/material/styles';
import { useFormStatus } from 'react-dom';

export type SubmitButtonProps = {
  label: string;
  submittingLabel?: string;
  fullWidth?: boolean;
  sx?: SxProps<Theme>;
  isDirty?: boolean;
  /**
   * When true, the button is wrapped in a sticky bottom bar so long
   * scrollable forms (AI Resource Routing/Capacity/Fallback, etc.)
   * keep the Save action reachable without scrolling. Default `false`
   * — opt in per-form. (Default-on caused the AI Connection edit
   * form's Save click to be intercepted by the sticky wrapper's
   * gradient background in headless tests; sticky is best applied
   * only to genuinely long-scroll forms.)
   */
  sticky?: boolean;
};

export default function SubmitButton({
  label,
  submittingLabel,
  fullWidth = false,
  sx,
  isDirty = true,
  sticky = false,
}: SubmitButtonProps) {
  const { pending } = useFormStatus();
  const button = (
    <Button
      type="submit"
      loading={pending}
      fullWidth={fullWidth}
      variant="contained"
      color="primary"
      disabled={pending || !isDirty}
      sx={{
        opacity: isDirty ? 1 : 0,
        transition: 'opacity 0.3s ease-in, transform 0.3s ease-in',
        marginBottom: sticky ? 0 : '16px',
        ...sx,
      }}
    >
      {pending ? submittingLabel || label : label}
    </Button>
  );

  if (!sticky) return button;

  return (
    <Box
      sx={{
        position: 'sticky',
        bottom: 0,
        zIndex: 2,
        py: 1,
        // Transparent so the bar inherits whatever container it's
        // rendered inside (most edit forms sit in `<AppContainer>`'s
        // `background.paper`, not the page's `background.default`).
        // A solid value would always be wrong for one of the two,
        // showing up as a visible band above Save.
        backgroundColor: 'transparent',
        display: 'flex',
        justifyContent: 'flex-end',
      }}
    >
      {button}
    </Box>
  );
}
