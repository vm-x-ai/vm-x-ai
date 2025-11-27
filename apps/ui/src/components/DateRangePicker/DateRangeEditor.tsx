import type { TextFieldProps } from '@mui/material';
import { Box, ClickAwayListener, Grid } from '@mui/material';
import { addMonths, addYears, isAfter, isBefore, isSameDay, isSameMonth, isWithinInterval, max, min } from 'date-fns';
import React, { useState } from 'react';
import { MARKERS } from './DateRangePicker';
import { defaultRanges } from './defaults';
import Menu from './Menu';
import type { DateRange, DateRangePickerValue, DefinedRange, NavigationAction, RelativeValue } from './types';
import { FormatDateForInput, getValidatedMonths, maskDateFormatter, parseOptionalDate } from './utils';

type Marker = symbol;

interface DateRangeEditorProps {
  value: DateRangePickerValue;
  onChange: (value: DateRangePickerValue) => void;
  mask?: string;
  dateInputDelimeter?: string;
  definedRanges?: DefinedRange[];
  minDate?: Date | string;
  maxDate?: Date | string;
  renderAbsoluteInput: (startProps: TextFieldProps, endProps: TextFieldProps) => React.ReactNode;
  renderRelativeInput: (inputProps: TextFieldProps, relativeValue?: RelativeValue) => React.ReactNode;
  cloneOnSelection?: boolean;
}

const DateRangeEditor: React.FC<DateRangeEditorProps> = (props: DateRangeEditorProps) => {
  const today = new Date();

  const {
    value,
    onChange,
    minDate,
    maxDate,
    definedRanges = defaultRanges,
    mask = '__/__/____',
    dateInputDelimeter = '/',
    cloneOnSelection = true,
  } = props;

  const minDateValid = parseOptionalDate(minDate, addYears(today, -10));
  const maxDateValid = parseOptionalDate(maxDate, addYears(today, 10));
  const [intialFirstMonth, initialSecondMonth] = getValidatedMonths(value.absolute, minDateValid, maxDateValid);
  const [daterange, setDaterange] = React.useState<DateRange>({ ...value.absolute });
  const [pendingValue, setPendingValue] = React.useState<DateRangePickerValue>(value);
  const [hoverDay, setHoverDay] = React.useState<Date>();
  const [firstMonth, setFirstMonth] = React.useState<Date>(intialFirstMonth || today);
  const [secondMonth, setSecondMonth] = React.useState<Date>(initialSecondMonth || addMonths(firstMonth, 1));

  const [openDateRangePicker, setOpenDateRangePicker] = useState(false);
  const [dateFrom, setDateFrom] = useState(FormatDateForInput(value.absolute?.startDate));
  const [dateTo, setDateTo] = useState(FormatDateForInput(value.absolute?.endDate));
  const [dateFromValidation, setDateFromValidation] = useState('');
  const [dateToValidation, setDateToValidation] = useState('');

  const { startDate, endDate } = daterange;

  const closeDateRangePicker = () => {
    setOpenDateRangePicker(false);
  };

  const onModelUpdate = (newValue: DateRange, dispatch = true) => {
    setDaterange(newValue);
    const dfrom = FormatDateForInput(newValue.startDate);
    const dto = FormatDateForInput(newValue.endDate);
    setDateFrom(() => dfrom);
    setDateTo(() => dto);

    dispatch &&
      setPendingValue({
        ...value,
        type: 'absolute',
        absolute: newValue,
      });

    if (cloneOnSelection && newValue.startDate && newValue.endDate) {
      closeDateRangePicker();
    }
  };

  const parseFromDate = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = event.target.value;
    const pdate = isDateValue(newValue);
    const newmodel: DateRange = { endDate, startDate: undefined };
    if (pdate && (!endDate || pdate < endDate)) {
      newmodel.startDate = pdate;
      setFirstMonthValidated(pdate);
      endDate && setSecondMonthValidated(isSameMonth(pdate, endDate) ? addMonths(pdate, 1) : endDate);
      setDateFromValidation('');
    } else {
      setDateFromValidation(newValue.length < 1 ? 'Required' : 'Please enter valid Date');
    }
    setDateFrom(maskDateFormatter(newValue, mask));
    setDaterange(newmodel);
    onChange({
      ...value,
      type: 'absolute',
      absolute: newmodel,
    });
  };

  const parseToDate = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = event.target.value;
    const pdate = isDateValue(newValue);
    const newmodel: DateRange = { endDate: undefined, startDate };
    if (pdate && startDate && pdate > startDate) {
      newmodel.endDate = pdate;
      setSecondMonthValidated(pdate);
      startDate && setFirstMonthValidated(isSameMonth(pdate, startDate) ? addMonths(pdate, -1) : startDate);
      setDateToValidation('');
    } else {
      setDateToValidation(newValue.length < 1 ? 'Required' : 'Please enter valid Date');
    }
    setDateTo(maskDateFormatter(newValue, mask));
    setDaterange(newmodel);
    onChange({
      ...value,
      type: 'absolute',
      absolute: newmodel,
    });
  };

  const isDateValue = (newValue: string) => {
    const dvals = newValue.split(dateInputDelimeter);
    if (newValue.length === mask.length && dvals.length > 2) {
      const dt = new Date(parseInt(dvals[2], 10), parseInt(dvals[0], 10) - 1, parseInt(dvals[1], 10));
      if (dt && dt > minDateValid && dt < maxDateValid) {
        return dt;
      }
    }
    return null;
  };

  // handlers
  const setFirstMonthValidated = (date: Date) => {
    if (isBefore(date, secondMonth)) {
      setFirstMonth(date);
    }
  };

  const setSecondMonthValidated = (date: Date) => {
    if (isAfter(date, firstMonth)) {
      setSecondMonth(date);
    }
  };

  const setDateRangeValidated = (range: DateRange) => {
    let { startDate: newStart, endDate: newEnd } = range;

    if (newStart && newEnd) {
      range.startDate = newStart = max([newStart, minDateValid]);
      range.endDate = newEnd = min([newEnd, maxDateValid]);

      onModelUpdate(range);

      setFirstMonth(newStart);
      setSecondMonth(isSameMonth(newStart, newEnd) ? addMonths(newStart, 1) : newEnd);
    } else {
      const emptyRange = {};

      onModelUpdate(emptyRange);

      setFirstMonth(today);
      setSecondMonth(addMonths(firstMonth, 1));
    }
  };

  const onDayClick = (day: Date) => {
    if (startDate && !endDate && !isBefore(day, startDate)) {
      const newRange = { endDate: day, startDate };
      onModelUpdate(newRange);
    } else {
      onModelUpdate({ endDate: undefined, startDate: day }, false);
    }
    setHoverDay(day);
  };

  const onMonthNavigate = (marker: Marker, action: NavigationAction) => {
    if (marker === MARKERS.FIRST_MONTH) {
      const firstNew = addMonths(firstMonth, action);
      if (isBefore(firstNew, secondMonth)) setFirstMonth(firstNew);
    } else {
      const secondNew = addMonths(secondMonth, action);
      if (isBefore(firstMonth, secondNew)) setSecondMonth(secondNew);
    }
  };

  const onDayHover = (date: Date) => {
    if (startDate && !endDate) {
      if (!hoverDay || !isSameDay(date, hoverDay)) {
        setHoverDay(date);
      }
    }
  };

  const onApply = () => {
    onChange(pendingValue);
    closeDateRangePicker();
  };

  // helpers
  const inHoverRange = (day: Date) =>
    (startDate &&
      !endDate &&
      hoverDay &&
      isAfter(hoverDay, startDate) &&
      isWithinInterval(day, {
        end: hoverDay,
        start: startDate,
      })) as boolean;

  const helpers = {
    inHoverRange,
  };

  const handlers = {
    onDayClick,
    onDayHover,
    onMonthNavigate,
  };

  return (
    <>
      <ClickAwayListener onClickAway={closeDateRangePicker}>
        <Box>
          <Grid style={{ alignItems: 'center', display: 'flex' }}>
            {props.value.type === 'relative' &&
              props.renderRelativeInput(
                {
                  value: `Last ${props.value.relative?.value} ${props.value.relative?.unit}(s)`,
                  onClick: () => setOpenDateRangePicker(true),
                  inputProps: { maxLength: 10 },
                  variant: 'outlined',
                  autoComplete: 'off',
                },
                props.value.relative,
              )}
            {props.value.type === 'absolute' &&
              props.renderAbsoluteInput(
                {
                  autoComplete: 'off',
                  error: dateFromValidation.length > 0,
                  helperText: dateFromValidation,
                  inputProps: { maxLength: 10 },
                  name: 'dateFrom',
                  onChange: parseFromDate,
                  onClick: () => setOpenDateRangePicker(true),
                  required: true,
                  value: dateFrom,
                  variant: 'outlined',
                },
                {
                  autoComplete: 'off',
                  error: dateToValidation.length > 0,
                  helperText: dateToValidation,
                  inputProps: { maxLength: 10 },
                  name: 'dateTo',
                  onChange: parseToDate,
                  onClick: () => setOpenDateRangePicker(true),
                  required: true,
                  value: dateTo,
                  variant: 'outlined',
                },
              )}
          </Grid>
          <Box style={{ position: 'absolute', zIndex: 100 }}>
            {openDateRangePicker && (
              <Menu
                value={pendingValue ?? props.value}
                minDate={minDateValid}
                maxDate={maxDateValid}
                ranges={definedRanges}
                firstMonth={firstMonth}
                secondMonth={secondMonth}
                setFirstMonth={setFirstMonthValidated}
                setSecondMonth={setSecondMonthValidated}
                setValue={(value: DateRangePickerValue) => {
                  if (value.type === 'absolute') {
                    setDateRangeValidated(value.absolute);
                  }

                  if (value.type === 'relative') {
                    setPendingValue(value);
                  }
                }}
                helpers={helpers}
                handlers={handlers}
                onApply={onApply}
              />
            )}
          </Box>
        </Box>
      </ClickAwayListener>
    </>
  );
};

export default DateRangeEditor;
