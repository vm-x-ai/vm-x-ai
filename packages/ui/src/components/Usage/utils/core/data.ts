import { CompletionUsageQueryResultDto } from '@/clients/api';

export function groupDataByTime(
  data: CompletionUsageQueryResultDto[]
): Record<string, CompletionUsageQueryResultDto[]> {
  return data.reduce<Record<string, CompletionUsageQueryResultDto[]>>(
    (acc, curr) => {
      const time = curr.time;
      if (!acc[time]) {
        acc[time] = [];
      }

      acc[time].push(curr);
      return acc;
    },
    {} as Record<string, CompletionUsageQueryResultDto[]>
  );
}
