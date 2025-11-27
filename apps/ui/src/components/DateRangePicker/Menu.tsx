import { ArrowRightAlt } from '@mui/icons-material';
import TabContext from '@mui/lab/TabContext';
import TabList from '@mui/lab/TabList';
import TabPanel from '@mui/lab/TabPanel';
import {
  Paper,
  Grid,
  Typography,
  Divider,
  styled,
  Box,
  TextField,
  ToggleButtonGroup,
  ToggleButton,
  Button,
} from '@mui/material';
import Tab from '@mui/material/Tab';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { TimePicker } from '@mui/x-date-pickers/TimePicker';
import { format, differenceInCalendarMonths } from 'date-fns';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import React, { useState } from 'react';
import { MARKERS } from './DateRangePicker';
import DefinedRanges from './DefinedRanges';
import Month from './Month';
import type { DefinedRange, Setter, NavigationAction, DateRangePickerValue } from './types';

dayjs.extend(utc);
dayjs.extend(timezone);

// Styled components
const StyledPaper = styled(Paper)(({ theme }) => ({
  backgroundColor: theme.palette.mode === 'dark' ? '#424242' : undefined,
  width: 290,
}));

const StyledHeader = styled(Grid)(() => ({
  padding: '20px 70px',
}));

const StyledHeaderItem = styled(Grid)(() => ({
  flex: 1,
  textAlign: 'center',
}));

interface MenuProps {
  value: DateRangePickerValue;
  ranges: DefinedRange[];
  minDate: Date;
  maxDate: Date;
  firstMonth: Date;
  secondMonth: Date;
  setFirstMonth: Setter<Date>;
  setSecondMonth: Setter<Date>;
  setValue: Setter<DateRangePickerValue>;
  helpers: {
    inHoverRange: (day: Date) => boolean;
  };
  handlers: {
    onDayClick: (day: Date) => void;
    onDayHover: (day: Date) => void;
    onMonthNavigate: (marker: symbol, action: NavigationAction) => void;
  };
  onApply?: () => void;
}
type StyledTimePickerProps = {
  value: Date | undefined;
  setValue: (date: Date | undefined) => void;
};

function StyledTimePicker({ value, setValue }: StyledTimePickerProps) {
  return (
    <>
      <TimePicker
        sx={{
          width: '100%',
        }}
        ampm={false}
        views={['hours', 'minutes', 'seconds']}
        value={dayjs(value)}
        timezone="UTC"
        onChange={(date) => {
          setValue(date?.toDate());
        }}
        slotProps={{
          textField(ownerState) {
            return {
              ...ownerState,
              variant: 'outlined',
              fullWidth: true,
              sx: {
                // ...ownerState,
                '& .MuiOutlinedInput-root': {
                  '& fieldset': {
                    borderColor: 'transparent', // Hides the border
                  },
                  '&:hover fieldset': {
                    borderColor: 'transparent', // Ensures the border stays hidden on hover
                  },
                  '&.Mui-focused fieldset': {
                    borderColor: 'transparent', // Ensures the border stays hidden when focused
                  },
                },
              },
            };
          },
        }}
      />
    </>
  );
}

const Menu: React.FunctionComponent<MenuProps> = ({
  ranges,
  value,
  minDate,
  maxDate,
  firstMonth,
  setFirstMonth,
  secondMonth,
  setSecondMonth,
  setValue,
  helpers,
  handlers,
  onApply,
}) => {
  const [tab, setTab] = useState(value.type ?? 'absolute');
  const { startDate, endDate } = value.absolute;
  const canNavigateCloser = differenceInCalendarMonths(secondMonth, firstMonth) >= 2;
  const commonProps = { dateRange: value.absolute, handlers, helpers, maxDate, minDate };

  return (
    <Paper elevation={5} square>
      <TabContext value={tab}>
        <TabList variant="fullWidth" aria-label="date picker tabs" onChange={(_, newValue) => setTab(newValue)}>
          <Tab label="Relative" value="relative" />
          <Tab label="Absolute" value="absolute" />
        </TabList>
        <TabPanel
          value="absolute"
          sx={{
            paddingBottom: '0',
          }}
        >
          <Grid container direction="row" wrap="nowrap">
            <Grid>
              <StyledHeader container alignItems="center">
                <StyledHeaderItem>
                  <Typography variant="subtitle1">
                    {startDate ? format(startDate, 'MMMM dd, yyyy') : 'Start Date'}
                  </Typography>
                </StyledHeaderItem>
                <StyledHeaderItem>
                  <ArrowRightAlt color="action" />
                </StyledHeaderItem>
                <StyledHeaderItem>
                  <Typography variant="subtitle1">{endDate ? format(endDate, 'MMMM dd, yyyy') : 'End Date'}</Typography>
                </StyledHeaderItem>
              </StyledHeader>
              <Divider />
              <Grid container direction="row" wrap="nowrap">
                <Month
                  {...commonProps}
                  value={firstMonth}
                  setValue={setFirstMonth}
                  navState={[true, canNavigateCloser]}
                  marker={MARKERS.FIRST_MONTH}
                />
                <Divider orientation="vertical" flexItem />
                <Month
                  {...commonProps}
                  value={secondMonth}
                  setValue={setSecondMonth}
                  navState={[canNavigateCloser, true]}
                  marker={MARKERS.SECOND_MONTH}
                />
              </Grid>
              <Divider />
              <Grid
                container
                direction="row"
                wrap="nowrap"
                sx={{
                  height: '4.8rem',
                }}
                alignItems="center"
              >
                <LocalizationProvider dateAdapter={AdapterDayjs}>
                  <StyledPaper square elevation={0}>
                    <Grid container height="100%">
                      <StyledTimePicker
                        value={value.absolute.startDate}
                        setValue={(date) => {
                          setValue({
                            ...value,
                            type: 'absolute',
                            absolute: { ...value.absolute, startDate: date },
                          });
                        }}
                      />
                    </Grid>
                  </StyledPaper>

                  <Divider orientation="vertical" flexItem />
                  <StyledPaper square elevation={0}>
                    <Grid container height="100%">
                      <StyledTimePicker
                        value={value.absolute.endDate}
                        setValue={(date) => {
                          setValue({
                            ...value,
                            type: 'absolute',
                            absolute: { ...value.absolute, endDate: date },
                          });
                        }}
                      />
                    </Grid>
                  </StyledPaper>
                </LocalizationProvider>
              </Grid>
            </Grid>
            <Divider orientation="vertical" flexItem />
            <Grid>
              <DefinedRanges
                selectedRange={value.absolute}
                ranges={ranges}
                setRange={(range) => {
                  setValue({
                    ...value,
                    type: 'absolute',
                    absolute: range,
                  });
                  onApply && onApply();
                }}
              />
            </Grid>
          </Grid>
        </TabPanel>
        <TabPanel value="relative">
          <Box width="44.75rem">
            <Grid container spacing={3}>
              <Grid size={12}>
                <Grid container spacing={3}>
                  <Grid size={3}>
                    <Typography variant="body1">Minutes</Typography>
                  </Grid>
                  <Grid size={9}>
                    <ToggleButtonGroup
                      color="primary"
                      onChange={(e, newValue) => {
                        setValue({
                          ...value,
                          type: 'relative',
                          relative: {
                            unit: 'minute',
                            value: newValue,
                          },
                        });
                      }}
                      value={value.relative?.unit === 'minute' ? value.relative.value : null}
                      exclusive
                      aria-label="Minutes"
                      fullWidth
                    >
                      <ToggleButton value={5}>5</ToggleButton>
                      <ToggleButton value={10}>10</ToggleButton>
                      <ToggleButton value={15}>15</ToggleButton>
                      <ToggleButton value={30}>30</ToggleButton>
                      <ToggleButton value={45}>45</ToggleButton>
                    </ToggleButtonGroup>
                  </Grid>
                </Grid>
              </Grid>
              <Grid size={12}>
                <Grid container spacing={3}>
                  <Grid size={3}>
                    <Typography variant="body1">Hours</Typography>
                  </Grid>
                  <Grid size={9}>
                    <ToggleButtonGroup
                      color="primary"
                      exclusive
                      onChange={(e, newValue) => {
                        setValue({
                          ...value,
                          type: 'relative',
                          relative: {
                            unit: 'hour',
                            value: newValue,
                          },
                        });
                      }}
                      value={value.relative?.unit === 'hour' ? value.relative.value : null}
                      aria-label="Hours"
                      fullWidth
                    >
                      <ToggleButton value={1}>1</ToggleButton>
                      <ToggleButton value={2}>2</ToggleButton>
                      <ToggleButton value={3}>3</ToggleButton>
                      <ToggleButton value={6}>6</ToggleButton>
                      <ToggleButton value={8}>8</ToggleButton>
                      <ToggleButton value={12}>12</ToggleButton>
                    </ToggleButtonGroup>
                  </Grid>
                </Grid>
              </Grid>
              <Grid size={12}>
                <Grid container spacing={3}>
                  <Grid size={3}>
                    <Typography variant="body1">Days</Typography>
                  </Grid>
                  <Grid size={9}>
                    <ToggleButtonGroup
                      color="primary"
                      onChange={(e, newValue) => {
                        setValue({
                          ...value,
                          type: 'relative',
                          relative: {
                            unit: 'day',
                            value: newValue,
                          },
                        });
                      }}
                      value={value.relative?.unit === 'day' ? value.relative.value : null}
                      exclusive
                      aria-label="Day"
                      fullWidth
                    >
                      <ToggleButton value={1}>1</ToggleButton>
                      <ToggleButton value={2}>2</ToggleButton>
                      <ToggleButton value={3}>3</ToggleButton>
                      <ToggleButton value={4}>4</ToggleButton>
                      <ToggleButton value={5}>5</ToggleButton>
                      <ToggleButton value={6}>6</ToggleButton>
                    </ToggleButtonGroup>
                  </Grid>
                </Grid>
              </Grid>
              <Grid size={12}>
                <Grid container spacing={3}>
                  <Grid size={3}>
                    <Typography variant="body1">Weeks</Typography>
                  </Grid>
                  <Grid size={9}>
                    <ToggleButtonGroup
                      color="primary"
                      onChange={(e, newValue) => {
                        setValue({
                          ...value,
                          type: 'relative',
                          relative: {
                            unit: 'week',
                            value: newValue,
                          },
                        });
                      }}
                      value={value.relative?.unit === 'week' ? value.relative.value : null}
                      exclusive
                      aria-label="Weeks"
                      fullWidth
                    >
                      <ToggleButton value={1}>1</ToggleButton>
                      <ToggleButton value={2}>2</ToggleButton>
                      <ToggleButton value={3}>3</ToggleButton>
                      <ToggleButton value={4}>4</ToggleButton>
                    </ToggleButtonGroup>
                  </Grid>
                </Grid>
              </Grid>
              <Grid size={12}>
                <Divider />
              </Grid>
              <Grid size={12}>
                <Grid container spacing={3}>
                  <Grid size={3}>
                    <TextField
                      label="Duration"
                      variant="outlined"
                      type="number"
                      value={value.relative?.value}
                      onChange={(e) => {
                        setValue({
                          ...value,
                          type: 'relative',
                          relative: {
                            ...(value.relative ?? { unit: 'minute' }),
                            value: Number(e.target.value),
                          },
                        });
                      }}
                      fullWidth
                    />
                  </Grid>
                  <Grid size={9}>
                    <ToggleButtonGroup
                      color="primary"
                      onChange={(e, newValue) => {
                        setValue({
                          ...value,
                          type: 'relative',
                          relative: {
                            ...(value.relative || { value: 0 }),
                            unit: newValue,
                          },
                        });
                      }}
                      value={value.relative?.unit}
                      exclusive
                      aria-label="Unit"
                      fullWidth
                      sx={{
                        height: '3.5rem',
                      }}
                    >
                      <ToggleButton value="minute">Minute</ToggleButton>
                      <ToggleButton value="hour">Hour</ToggleButton>
                      <ToggleButton value="day">Day</ToggleButton>
                      <ToggleButton value="week">Week</ToggleButton>
                    </ToggleButtonGroup>
                  </Grid>
                </Grid>
              </Grid>
            </Grid>
          </Box>
        </TabPanel>
      </TabContext>
      <Grid container spacing={2} paddingLeft={3} paddingRight={3} paddingBottom={3}>
        <Grid size={12}>
          <Divider />
        </Grid>
        <Grid size={12}>
          <Button
            variant="contained"
            color="primary"
            onClick={() => {
              onApply && onApply();
            }}
          >
            Apply
          </Button>
        </Grid>
      </Grid>
    </Paper>
  );
};

export default Menu;
