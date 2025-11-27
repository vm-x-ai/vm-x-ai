import React from 'react';

import type { DateRangePickerWrapperProps } from './DateRangePickerWrapper';
import DateRangePickerWrapper from './DateRangePickerWrapper';

const DateRangePickerExporter: React.FC<DateRangePickerWrapperProps> = (props: DateRangePickerWrapperProps) => (
  <DateRangePickerWrapper {...props} />
);

export default DateRangePickerExporter;
