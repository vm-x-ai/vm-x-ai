import { List, ListItemButton, ListItemText } from '@mui/material';
import { isSameDay } from 'date-fns';
import React from 'react';
import type { DefinedRange, DateRange } from './types';

type DefinedRangesProps = {
  setRange: (range: DateRange) => void;
  selectedRange: DateRange;
  ranges: DefinedRange[];
};

const isSameRange = (first: DateRange, second: DateRange) => {
  const { startDate: fStart, endDate: fEnd } = first;
  const { startDate: sStart, endDate: sEnd } = second;
  if (fStart && sStart && fEnd && sEnd) {
    return isSameDay(fStart, sStart) && isSameDay(fEnd, sEnd);
  }
  return false;
};

const DefinedRanges: React.FunctionComponent<DefinedRangesProps> = (props) => {
  return (
    <List>
      {props.ranges.map((range, idx) => (
        <ListItemButton key={idx} onClick={() => props.setRange(range)}>
          <ListItemText
            primaryTypographyProps={{
              style: {
                fontWeight: isSameRange(range, props.selectedRange) ? 'bold' : 'normal',
              },
              variant: 'body2',
            }}
          >
            {range.label}
          </ListItemText>
        </ListItemButton>
      ))}
    </List>
  );
};

export default DefinedRanges;
