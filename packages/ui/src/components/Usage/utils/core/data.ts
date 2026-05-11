import { RequestUsageQueryResultDto } from '@/clients/api';

export function groupDataByTime(
  data: RequestUsageQueryResultDto[]
): Record<string, RequestUsageQueryResultDto[]> {
  return data.reduce<Record<string, RequestUsageQueryResultDto[]>>(
    (acc, curr) => {
      const time = curr.time;
      if (!acc[time]) {
        acc[time] = [];
      }

      acc[time].push(curr);
      return acc;
    },
    {} as Record<string, RequestUsageQueryResultDto[]>
  );
}
