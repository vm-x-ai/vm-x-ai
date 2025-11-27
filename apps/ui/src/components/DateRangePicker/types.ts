export interface DateRange {
  startDate?: Date;
  endDate?: Date;
}

export type Setter<T> = React.Dispatch<React.SetStateAction<T>> | ((value: T) => void);

export enum NavigationAction {
  Previous = -1,
  Next = 1,
}

export type DefinedRange = {
  startDate: Date;
  endDate: Date;
  label: string;
};

export type RelativeValueUnit = 'minute' | 'hour' | 'day' | 'week';

export interface RelativeValue {
  value: number;
  unit: RelativeValueUnit;
}

export type DateRangePickerValue = {
  type: 'relative' | 'absolute';
  absolute: DateRange;
  relative?: RelativeValue;
};
