'use client';

import Button from '@mui/material/Button';
import type { SxProps, Theme } from '@mui/material/styles';
import { useFormStatus } from 'react-dom';

export type SubmitButtonProps = {
  label: string;
  submittingLabel?: string;
  fullWidth?: boolean;
  sx?: SxProps<Theme>;
  isDirty?: boolean;
};

export default function SubmitButton({
  label,
  submittingLabel,
  fullWidth = false,
  sx,
  isDirty = true,
}: SubmitButtonProps) {
  const { pending } = useFormStatus();
  return (
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
        marginBottom: '16px',
        ...sx,
      }}
    >
      {pending ? submittingLabel || label : label}
    </Button>
  );
}
