'use client';

import type { CartesianMarkerProps } from '@nivo/core';
import { useTheme } from '@nivo/theming';
import type { LineSeries, LineSvgProps, SliceTooltipProps } from '@nivo/line';
import { ResponsiveLine } from '@nivo/line';
import { numberWithCommas } from '@/utils/number';
import { isBefore, isEqual } from 'date-fns';
import React, { useState } from 'react';

export type LineChartProps = {
  data: LineSvgProps<LineSeries>['data'];
  onRangeSelected?: (startDate: Date, endDate: Date) => void;
} & Partial<Omit<LineSvgProps<LineSeries>, 'data'>>;

export default function LineChart({
  data,
  onRangeSelected,
  ...props
}: LineChartProps) {
  const theme = useTheme();
  const [selectedRange, setSelectedRange] = useState<{
    startDate?: Date;
    endDate?: Date;
  }>({});

  return (
    <ResponsiveLine
      {...props}
      theme={theme}
      data={data}
      curve="linear"
      colors={{ scheme: 'tableau10' }}
      margin={{ top: 50, right: 200, bottom: 100, left: 100 }}
      yScale={{
        type: 'linear',
      }}
      enableArea
      enableSlices="x"
      onClick={(point) => {
        const points = (
          point as unknown as SliceTooltipProps<LineSeries>['slice']
        ).points;
        const pointDate = points[0].data.x as Date;
        if (
          selectedRange.startDate &&
          isEqual(selectedRange.startDate, pointDate)
        ) {
          setSelectedRange({ startDate: undefined, endDate: undefined });
          return;
        }

        if (
          selectedRange.startDate &&
          isBefore(pointDate, selectedRange.startDate)
        ) {
          setSelectedRange({ startDate: pointDate, endDate: undefined });
        } else if (selectedRange.startDate) {
          setSelectedRange({ startDate: undefined, endDate: undefined });
          onRangeSelected?.(selectedRange.startDate, pointDate);
        } else {
          setSelectedRange({ startDate: pointDate, endDate: undefined });
        }
      }}
      markers={
        [
          selectedRange.startDate
            ? {
                axis: 'x',
                legend: 'from',
                lineStyle: {
                  stroke: '#2638D9',
                  strokeWidth: 2,
                  strokeDasharray: '4 4',
                },
                value: selectedRange.startDate,
              }
            : undefined,
          selectedRange.endDate
            ? {
                axis: 'x',
                legend: 'to',
                lineStyle: {
                  stroke: '#2638D9',
                  strokeDasharray: '4 4',
                  strokeWidth: 2,
                },
                value: selectedRange.endDate,
              }
            : undefined,
        ].filter((item) => !!item) as CartesianMarkerProps[]
      }
      sliceTooltip={({ slice }) => {
        return (
          <div
            style={{
              // Pull every surface property from the theme — the
              // nivoTheme uses CSS variables so all three flip with
              // the active MUI colour scheme.
              background: theme.tooltip.container.background,
              color: theme.tooltip.container.color,
              border: theme.tooltip.container.border,
              padding: '9px 12px',
              borderRadius: '3px',
              whiteSpace: 'nowrap',
              width: 'auto',
            }}
          >
            {slice.points[0].data.xFormatted}
            {slice.points.map((point) => {
              const formattedNumber =
                typeof point.data.y === 'number'
                  ? numberWithCommas(point.data.y)
                  : String(point.data.y);

              return (
                <div
                  key={point.id}
                  style={{
                    color: point.seriesColor,
                    padding: '3px 0',
                  }}
                >
                  <strong>{point.seriesId}</strong> [
                  {point.data.yFormatted === String(point.data.y)
                    ? formattedNumber
                    : `${point.data.yFormatted} - ${formattedNumber}`}
                  ]
                </div>
              );
            })}
          </div>
        );
      }}
      axisBottom={{
        ...(props.axisBottom || {}),
        tickSize: 5,
        tickPadding: 5,
        tickRotation: 0,
        legendOffset: 36,
        legendPosition: 'middle',
      }}
      axisLeft={{
        ...(props.axisLeft || {}),
        tickSize: 5,
        tickPadding: 5,
        tickRotation: 0,
        legendOffset: -70,
        legendPosition: 'middle',
      }}
      pointSize={5}
      // Filled with the series color so markers stay legible whether the
      // chart background is light or dark (the theme uses a transparent
      // background to inherit the surrounding card surface).
      pointColor={{ from: 'seriesColor' }}
      pointBorderWidth={1}
      pointBorderColor={{ from: 'seriesColor' }}
      pointLabelYOffset={-12}
      useMesh={true}
      legends={[
        {
          anchor: 'bottom-right',
          direction: 'column',
          justify: false,
          translateX: 100,
          translateY: 0,
          itemsSpacing: 0,
          itemDirection: 'left-to-right',
          itemWidth: 80,
          itemHeight: 20,
          itemOpacity: 0.75,
          symbolSize: 12,
          symbolShape: 'circle',
          effects: [
            {
              on: 'hover',
              style: {
                itemOpacity: 1,
              },
            },
          ],
        },
      ]}
    />
  );
}
