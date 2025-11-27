import { ChevronLeft, ChevronRight } from '@mui/icons-material';
import type { SelectChangeEvent } from '@mui/material';
import { Grid, IconButton, Select, MenuItem, styled } from '@mui/material';
import { setMonth, getMonth, setYear, getYear } from 'date-fns';
import React from 'react';

interface HeaderProps {
  date: Date;
  setDate: (date: Date) => void;
  nextDisabled: boolean;
  prevDisabled: boolean;
  onClickNext: () => void;
  onClickPrevious: () => void;
}

// Styled components
const StyledGrid = styled(Grid)(() => ({
  justifyContent: 'space-around',
}));

const IconContainer = styled(Grid)(() => ({
  padding: 5,
}));

const StyledIconButton = styled(IconButton)(() => ({
  padding: 10,
  '&:hover': {
    background: 'none',
  },
}));

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'June',
  'July',
  'Aug',
  'Sept',
  'Oct',
  'Nov',
  'Dec',
];

const generateYears = (relativeTo: Date, count: number) => {
  const half = Math.floor(count / 2);
  return Array(count)
    .fill(0)
    .map((_, i) => relativeTo.getFullYear() - half + i);
};

const Header: React.FunctionComponent<HeaderProps> = ({
  date,
  setDate,
  nextDisabled,
  prevDisabled,
  onClickNext,
  onClickPrevious,
}) => {
  const handleMonthChange = (event: SelectChangeEvent<number>) => {
    setDate(setMonth(date, Number(event.target.value)));
  };

  const handleYearChange = (event: SelectChangeEvent<number>) => {
    setDate(setYear(date, Number(event.target.value)));
  };

  return (
    <StyledGrid container alignItems="center">
      <IconContainer>
        <StyledIconButton disabled={prevDisabled} onClick={onClickPrevious}>
          <ChevronLeft color={prevDisabled ? 'disabled' : 'action'} />
        </StyledIconButton>
      </IconContainer>
      <Grid>
        <Select
          variant="standard"
          value={getMonth(date)}
          onChange={handleMonthChange}
          MenuProps={{ disablePortal: true }}
        >
          {MONTHS.map((month, idx) => (
            <MenuItem key={month} value={idx}>
              {month}
            </MenuItem>
          ))}
        </Select>
      </Grid>

      <Grid>
        <Select
          variant="standard"
          value={getYear(date)}
          onChange={handleYearChange}
          MenuProps={{ disablePortal: true }}
        >
          {generateYears(date, 30).map((year) => (
            <MenuItem key={year} value={year}>
              {year}
            </MenuItem>
          ))}
        </Select>
      </Grid>
      <IconContainer>
        <StyledIconButton disabled={nextDisabled} onClick={onClickNext}>
          <ChevronRight color={nextDisabled ? 'disabled' : 'action'} />
        </StyledIconButton>
      </IconContainer>
    </StyledGrid>
  );
};

export default Header;
