import {
  startOfWeek,
  startOfMonth,
  endOfWeek,
  endOfMonth,
  isBefore,
  addDays,
  isSameDay,
  isWithinInterval,
  toDate,
  parseISO,
  isValid,
  isSameMonth,
  addMonths,
  min,
  max,
  subDays,
  subMinutes,
  subHours,
  subWeeks,
} from 'date-fns';
import { format, toZonedTime } from 'date-fns-tz';
import type { DateRange, DateRangePickerValue } from './types';

export const identity = <T>(x: T) => x;

export const chunks = <T>(array: ReadonlyArray<T>, size: number): T[][] => {
  return Array.from({ length: Math.ceil(array.length / size) }, (v, i) => array.slice(i * size, i * size + size));
};

export const combine = (...args: unknown[]): string => args.filter(identity).join(' ');

// Date
export const getDaysInMonth = (date: Date) => {
  const startWeek = startOfWeek(startOfMonth(date));
  const endWeek = endOfWeek(endOfMonth(date));
  const days = [];
  for (let curr = startWeek; isBefore(curr, endWeek); ) {
    days.push(curr);
    curr = addDays(curr, 1);
  }
  return days;
};

export const isStartOfRange = ({ startDate }: DateRange, day: Date) =>
  (startDate && isSameDay(day, startDate)) as boolean;

export const isEndOfRange = ({ endDate }: DateRange, day: Date) => (endDate && isSameDay(day, endDate)) as boolean;

export const inDateRange = ({ startDate, endDate }: DateRange, day: Date) =>
  (startDate &&
    endDate &&
    (isWithinInterval(day, {
      end: endDate,
      start: startDate,
    }) ||
      isSameDay(day, startDate) ||
      isSameDay(day, endDate))) as boolean;

export const isRangeSameDay = ({ startDate, endDate }: DateRange) => {
  if (startDate && endDate) {
    return isSameDay(startDate, endDate);
  }
  return false;
};

type Falsy = false | null | undefined | 0 | '';

export const parseOptionalDate = (date: Date | string | Falsy, defaultValue: Date) => {
  if (date instanceof Date) {
    const parsed = toDate(date);
    if (isValid(parsed)) return parsed;
  }

  if (date instanceof String) {
    const parsed = parseISO(date as string);
    if (isValid(parsed)) return parsed;
  }

  return defaultValue;
};

export const getValidatedMonths = (range: DateRange, minDate: Date, maxDate: Date) => {
  const { startDate, endDate } = range;
  if (startDate && endDate) {
    const newStart = max([startDate, minDate]);
    const newEnd = min([endDate, maxDate]);

    return [newStart, isSameMonth(newStart, newEnd) ? addMonths(newStart, 1) : newEnd];
  }
  return [startDate, endDate];
};

export const formatInTimeZone = (date: Date, fmt: string, timezone: string) =>
  format(toZonedTime(date, timezone), fmt, { timeZone: timezone });

export const FormatDateForInput = (date: Date | null | undefined) => {
  //Date -> yyyy-MM-dd HH:mm:ss
  if (date) {
    return `${formatInTimeZone(date, 'yyyy-MM-dd HH:mm:ss', 'UTC')} (UTC)`;
  }
  return '';
};

export const maskDateFormatter = (value: string, mask: string, maskInputChar = '_') => {
  const acceptRegexp = /[\d]/gi;
  return value
    .split('')
    .map((char, i) => {
      acceptRegexp.lastIndex = 0;

      if (i > mask.length - 1) {
        return '';
      }

      const maskChar = mask[i];
      const nextMaskChar = mask[i + 1];

      const acceptedChar = acceptRegexp.test(char) ? char : '';
      const formattedChar = maskChar === maskInputChar ? acceptedChar : maskChar + acceptedChar;

      if (i === value.length - 1 && nextMaskChar && nextMaskChar !== maskInputChar) {
        // add / after num input
        return formattedChar ? formattedChar + nextMaskChar : '';
      }

      return formattedChar;
    })
    .join('');
};

const relativeUnitMap: Record<string, (date: Date, amount: number) => Date> = {
  minute: subMinutes,
  hour: subHours,
  day: subDays,
  week: subWeeks,
};

export function parseDateRangePickerValue(
  value: DateRangePickerValue,
  parser: (value?: Date) => string,
): { start: string; end: string } {
  if (value.type === 'absolute') {
    return { start: parser(value.absolute.startDate), end: parser(value.absolute.endDate) };
  } else {
    const unit = value.relative?.unit ?? 'minute';
    const relativeValue = value.relative?.value ?? 30;

    return { start: parser(relativeUnitMap[unit](new Date(), relativeValue)), end: parser() };
  }
}
