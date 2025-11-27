import type { IconButtonProps, TypographyProps } from '@mui/material';
import { IconButton, Typography, styled } from '@mui/material';
import * as React from 'react';

type ButtonContainerProps = {
  startOfRange?: boolean;
  endOfRange?: boolean;
  highlighted?: boolean;
  disabled?: boolean;
};

// Styled components
const ButtonContainer = styled('div', {
  shouldForwardProp: (prop) =>
    prop !== 'startOfRange' && prop !== 'endOfRange' && prop !== 'highlighted' && prop !== 'disabled',
})<ButtonContainerProps>(({ theme, startOfRange, endOfRange, highlighted, disabled }) => ({
  display: 'flex',
  ...(startOfRange && {
    borderRadius: '50% 0 0 50%',
  }),
  ...(endOfRange && {
    borderRadius: '0 50% 50% 0',
  }),
  ...(highlighted &&
    !disabled && {
      backgroundColor: theme.palette.mode === 'dark' ? '#e3f2fd6e' : '#bbdefb7d',
    }),
}));

type StyledIconButton = IconButtonProps & {
  filled?: boolean;
  outlined?: boolean;
  disabled?: boolean;
};

const StyledIconButton = styled(IconButton, {
  shouldForwardProp: (prop) => prop !== 'filled' && prop !== 'outlined' && prop !== 'disabled',
})<StyledIconButton>(({ theme, filled, outlined, disabled }) => ({
  height: 36,
  padding: 0,
  width: 36,
  ...(outlined &&
    !disabled && {
      border: `1px solid ${theme.palette.primary.dark}`,
    }),
  ...(filled &&
    !disabled && {
      backgroundColor: theme.palette.primary.dark,
      '&:hover': {
        backgroundColor: theme.palette.primary.dark,
      },
      color: theme.palette.primary.contrastText,
    }),
}));

type ButtonTextProps = TypographyProps & {
  filled?: boolean;
  disabled?: boolean;
};

const ButtonText = styled(Typography)<ButtonTextProps>(({ theme, filled, disabled }) => ({
  lineHeight: 1.6,
  color:
    filled && !disabled ? theme.palette.primary.contrastText : theme.palette.mode === 'light' ? 'initial' : undefined,
}));

interface DayProps {
  filled?: boolean;
  outlined?: boolean;
  highlighted?: boolean;
  disabled?: boolean;
  startOfRange?: boolean;
  endOfRange?: boolean;
  onClick?: () => void;
  onHover?: () => void;
  value: number | string;
}

const Day: React.FunctionComponent<DayProps> = ({
  filled,
  outlined,
  highlighted,
  disabled,
  startOfRange,
  endOfRange,
  onClick,
  onHover,
  value,
}) => {
  return (
    <ButtonContainer startOfRange={startOfRange} endOfRange={endOfRange} highlighted={highlighted} disabled={disabled}>
      <StyledIconButton filled={filled} outlined={outlined} disabled={disabled} onClick={onClick} onMouseOver={onHover}>
        <ButtonText filled={filled} disabled={disabled} variant="body2">
          {!disabled && value}
        </ButtonText>
      </StyledIconButton>
    </ButtonContainer>
  );
};

export default Day;
