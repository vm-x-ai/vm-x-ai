import {
  addDays,
  startOfWeek,
  endOfWeek,
  addWeeks,
  startOfMonth,
  endOfMonth,
  subDays,
  startOfYear,
  subMinutes,
  subHours,
  startOfDay,
  endOfDay,
} from 'date-fns';
import type { DefinedRange } from './types';

const getDefaultRanges = (date: Date): DefinedRange[] => [
  {
    endDate: date,
    label: 'Last 30 Minutes',
    startDate: subMinutes(date, 30),
  },
  {
    endDate: date,
    label: 'Last Hour',
    startDate: subMinutes(date, 60),
  },
  {
    endDate: date,
    label: 'Last 3 Hours',
    startDate: subHours(date, 3),
  },
  {
    endDate: endOfDay(date),
    label: 'Today',
    startDate: startOfDay(date),
  },
  {
    endDate: endOfDay(addDays(date, -1)),
    label: 'Yesterday',
    startDate: startOfDay(addDays(date, -1)),
  },
  {
    endDate: endOfDay(date),
    label: 'Last 30 Days',
    startDate: startOfDay(subDays(date, 30)),
  },
  {
    endDate: endOfDay(endOfWeek(date)),
    label: 'This Week',
    startDate: startOfDay(startOfWeek(date)),
  },
  {
    endDate: endOfDay(endOfWeek(addWeeks(date, -1))),
    label: 'Last Week',
    startDate: startOfDay(startOfWeek(addWeeks(date, -1))),
  },
  {
    endDate: endOfDay(endOfMonth(date)),
    label: 'This Month',
    startDate: startOfDay(startOfMonth(date)),
  },
  {
    endDate: endOfDay(date),
    label: 'This year',
    startDate: startOfDay(startOfYear(date)),
  },
];

export const defaultRanges = getDefaultRanges(new Date());
