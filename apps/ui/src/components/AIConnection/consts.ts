import { CapacityEntity, CapacityPeriod } from '@/clients/api';

export const DEFAULT_CAPACITY: CapacityEntity[] = [
  {
    requests: 0,
    tokens: 0,
    period: CapacityPeriod.MINUTE,
    enabled: false,
  },
  {
    requests: 0,
    tokens: 0,
    period: CapacityPeriod.HOUR,
    enabled: false,
  },
  {
    requests: 0,
    tokens: 0,
    period: CapacityPeriod.DAY,
    enabled: false,
  },
  {
    requests: 0,
    tokens: 0,
    period: CapacityPeriod.WEEK,
    enabled: false,
  },
  {
    requests: 0,
    tokens: 0,
    period: CapacityPeriod.MONTH,
    enabled: false,
  },
];
