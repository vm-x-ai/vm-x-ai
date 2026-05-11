import type { LineSeries, AllowedValue } from '@nivo/line';
import { groupDataByTime } from '../../core';
import {
  RequestDimensions,
  RequestUsageDimensionValueDto,
  RequestUsageQueryResultDto,
} from '@/clients/api';

type LineDatum = {
  x: AllowedValue;
  y: AllowedValue;
};

type EditableSerie = Omit<LineSeries, 'data'> & {
  data: LineDatum[];
};

export const toNivoLineSerie = (
  data: RequestUsageQueryResultDto[],
  // Accepts either standard RequestDimensions enum values or dynamic
  // metadata dimension strings (`metadata.<key>`) — both are addressed via
  // the same `value[dim]` lookup on rows so the runtime is uniform.
  dimensions: (RequestDimensions | string)[] = [],
  metrics: string[] = [],
  timeColumn = 'time'
): LineSeries[] => {
  const groups = defineGroups(dimensions, metrics, data);
  const usageByTime = groupDataByTime(data);

  Object.entries(usageByTime).forEach(([time, values], idx) => {
    for (const value of values) {
      for (const metric of metrics) {
        const groupKey =
          dimensions.length > 0
            ? `${dimensions
                .map((dim) =>
                  typeof (value as Record<string, unknown>)[dim] === 'object'
                    ? (
                        (value as Record<string, unknown>)[
                          dim
                        ] as RequestUsageDimensionValueDto
                      )?.displayName
                    : ((value as Record<string, unknown>)[dim] as string)
                )
                .join(' - ')} - ${metric}`
            : metric;
        if (groups[groupKey]) {
          groups[groupKey].data[idx] = {
            x: time,
            y:
              (groups[groupKey].data[idx]?.y as number) ||
              0 +
                (value[metric as keyof RequestUsageQueryResultDto] as number) ||
              0,
          };
        }

        Object.entries(groups)
          .filter(([key]) => key !== groupKey)
          .forEach(([, group]) => {
            group.data[idx] = {
              x: time,
              y: (group.data[idx]?.y as number) || 0,
            };
          });
      }
    }
  });

  if (dimensions.length > 0 && Object.keys(groups).length > metrics.length) {
    Object.entries(groups).forEach(([key, group]) => {
      if (metrics.includes(key) && group.data.every((d) => d.y === 0)) {
        delete groups[key];
      }
    });
  }

  return Object.values(groups) as unknown as LineSeries[];
};

function defineGroups(
  dimensions: (RequestDimensions | string)[],
  metrics: string[],
  data: RequestUsageQueryResultDto[]
): Record<string, EditableSerie> {
  const metricCount: Record<string, number> = {};

  const groups = (
    dimensions.length > 0
      ? data.reduce((acc, curr) => {
          const dimensionKey = dimensions
            .map((dim) =>
              typeof (curr as Record<string, unknown>)[dim] === 'object'
                ? (
                    (curr as Record<string, unknown>)[
                      dim
                    ] as RequestUsageDimensionValueDto
                  )?.displayName
                : ((curr as Record<string, unknown>)[dim] as string)
            )
            .filter((v) => !!v)
            .join(' - ');

          for (const metric of metrics) {
            if (dimensionKey !== '' && !acc[dimensionKey]) {
              const key = `${dimensionKey} - ${metric}`;
              acc[key] = {
                id: key,
                data: [],
              };
            } else {
              acc[metric] = {
                id: metric,
                data: [],
              };
            }

            metricCount[metric] = (metricCount[metric] || 0) + 1;
          }

          return acc;
        }, {} as Record<string, EditableSerie>)
      : metrics.reduce((acc, curr) => {
          acc[curr] = {
            id: curr,
            data: [],
          };
          metricCount[curr] = (metricCount[curr] || 0) + 1;
          return acc;
        }, {} as Record<string, EditableSerie>)
  ) as Record<string, EditableSerie>;

  return groups;
}
