import type { GridProps } from '@mui/material';
import { Paper, Grid, Typography, styled } from '@mui/material';
import { getDate, isSameMonth, isToday, format, isWithinInterval } from 'date-fns';
import * as React from 'react';
import Day from './Day';
import Header from './Header';
import type { DateRange } from './types';
import { NavigationAction } from './types';
import { chunks, getDaysInMonth, isStartOfRange, isEndOfRange, inDateRange, isRangeSameDay } from './utils';

const WEEK_DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

// Styled components
const StyledPaper = styled(Paper)(({ theme }) => ({
  backgroundColor: theme.palette.mode === 'dark' ? '#424242' : undefined,
  width: 290,
}));

const DaysContainer = styled(Grid)<GridProps>(() => ({
  marginBottom: 20,
  marginTop: 15,
  paddingLeft: 15,
  paddingRight: 15,
}));

const DaysRowContainer = styled(Grid)(() => ({
  marginBottom: 1,
  marginTop: 1,
}));

const WeekDaysContainer = styled(Grid)<GridProps>(() => ({
  justifyContent: 'space-around',
  marginTop: 10,
  paddingLeft: 30,
  paddingRight: 30,
}));

interface MonthProps {
  value: Date;
  marker: symbol;
  dateRange: DateRange;
  minDate: Date;
  maxDate: Date;
  navState: [boolean, boolean];
  setValue: (date: Date) => void;
  helpers: {
    inHoverRange: (day: Date) => boolean;
  };
  handlers: {
    onDayClick: (day: Date) => void;
    onDayHover: (day: Date) => void;
    onMonthNavigate: (marker: symbol, action: NavigationAction) => void;
  };
}

const Month: React.FunctionComponent<MonthProps> = ({
  helpers,
  handlers,
  value: date,
  dateRange,
  marker,
  setValue: setDate,
  minDate,
  maxDate,
  navState,
}) => {
  const [back, forward] = navState;
  return (
    <StyledPaper square elevation={0}>
      <Grid container>
        <Header
          date={date}
          setDate={setDate}
          nextDisabled={!forward}
          prevDisabled={!back}
          onClickPrevious={() => handlers.onMonthNavigate(marker, NavigationAction.Previous)}
          onClickNext={() => handlers.onMonthNavigate(marker, NavigationAction.Next)}
        />

        <WeekDaysContainer container direction="row" component="div">
          {WEEK_DAYS.map((day) => (
            <Typography color="textSecondary" key={day} variant="caption">
              {day}
            </Typography>
          ))}
        </WeekDaysContainer>

        <DaysContainer container direction="column" component="div">
          {chunks(getDaysInMonth(date), 7).map((week, idx) => (
            <DaysRowContainer key={idx} container direction="row">
              {week.map((day) => {
                const isStart = isStartOfRange(dateRange, day);
                const isEnd = isEndOfRange(dateRange, day);
                const isRangeOneDay = isRangeSameDay(dateRange);
                const highlighted = inDateRange(dateRange, day) || helpers.inHoverRange(day);

                return (
                  <Day
                    key={format(day, 'mm-dd-yyyy')}
                    filled={isStart || isEnd}
                    outlined={isToday(day)}
                    highlighted={highlighted && !isRangeOneDay}
                    disabled={
                      !isSameMonth(date, day) ||
                      !isWithinInterval(day, {
                        end: maxDate,
                        start: minDate,
                      })
                    }
                    startOfRange={isStart && !isRangeOneDay}
                    endOfRange={isEnd && !isRangeOneDay}
                    onClick={() => handlers.onDayClick(day)}
                    onHover={() => handlers.onDayHover(day)}
                    value={getDate(day)}
                  />
                );
              })}
            </DaysRowContainer>
          ))}
        </DaysContainer>
      </Grid>
    </StyledPaper>
  );
};

export default Month;
