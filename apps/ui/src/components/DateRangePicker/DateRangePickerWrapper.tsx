import { styled } from '@mui/material/styles';
import React from 'react';

import DateRangePicker from './DateRangePicker';
import type { DateRange, DefinedRange } from './types';

const DateRangeBackdrop = styled('div')(() => ({
  bottom: 0,
  height: '100vh',
  left: 0,
  position: 'fixed',
  right: 0,
  top: 0,
  width: '100vw',
  zIndex: 0,
}));

const DateRangePickerContainer = styled('div')({
  position: 'relative',
});

const DateRangePickerStyled = styled('div')(() => ({
  position: 'relative',
  zIndex: 1,
}));

export interface DateRangePickerWrapperProps {
  open: boolean;
  toggle: () => void;
  initialDateRange?: DateRange;
  definedRanges?: DefinedRange[];
  minDate?: Date | string;
  maxDate?: Date | string;
  onChange: (dateRange: DateRange) => void;
  closeOnClickOutside?: boolean;
  wrapperClassName?: string;
}

const DateRangePickerWrapper: React.FC<DateRangePickerWrapperProps> = (props: DateRangePickerWrapperProps) => {
  const { closeOnClickOutside, wrapperClassName, toggle, open } = props;

  const handleToggle = () => {
    if (closeOnClickOutside === false) {
      return;
    }
    toggle();
  };

  const handleKeyPress = (event: React.KeyboardEvent) => event?.key === 'Escape' && handleToggle();

  return (
    <DateRangePickerContainer>
      {open && <DateRangeBackdrop onKeyPress={handleKeyPress} onClick={handleToggle} />}

      <DateRangePickerStyled className={wrapperClassName}>
        <DateRangePicker {...props} />
      </DateRangePickerStyled>
    </DateRangePickerContainer>
  );
};

export default DateRangePickerWrapper;
