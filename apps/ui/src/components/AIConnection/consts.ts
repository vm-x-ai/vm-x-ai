import { CapacityEntity } from '@/clients/api';

export const DEFAULT_CAPACITY: CapacityEntity[] = [
  {
    requests: 0,
    tokens: 0,
    period: 'MINUTE',
    enabled: false,
  },
  {
    requests: 0,
    tokens: 0,
    period: 'HOUR',
    enabled: false,
  },
  {
    requests: 0,
    tokens: 0,
    period: 'DAY',
    enabled: false,
  },
  {
    requests: 0,
    tokens: 0,
    period: 'WEEK',
    enabled: false,
  },
  {
    requests: 0,
    tokens: 0,
    period: 'MONTH',
    enabled: false,
  },
];
