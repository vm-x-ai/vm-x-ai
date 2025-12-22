'use client';

import React from 'react';
import { BaseSummaryTable } from './BaseSummaryTable';
import { CompletionUsageQueryResultDto } from '@/clients/api';

export type Top10TTFTTableProps = {
  data: CompletionUsageQueryResultDto[];
  autoRefresh: boolean;
  autoRefreshInterval?: number;
  autoRefreshAction?: () => Promise<
    CompletionUsageQueryResultDto[] | undefined
  >;
};

export function Top10TTFTTable({
  data,
  autoRefresh,
  autoRefreshInterval,
  autoRefreshAction,
}: Top10TTFTTableProps) {
  return (
    <BaseSummaryTable
      columns={[
        {
          accessorKey: 'provider.displayName',
          header: 'Provider',
        },
        {
          accessorKey: 'model',
          header: 'Model',
        },
        {
          accessorKey: 'timeToFirstToken',
          header: 'Average ms',
          enableGrouping: false,
          Cell: ({ row: { original: row } }) =>
            ((row.timeToFirstToken as number) ?? 0).toFixed(2),
        },
      ]}
      data={data}
      autoRefresh={autoRefresh}
      autoRefreshInterval={autoRefreshInterval}
      autoRefreshAction={autoRefreshAction}
    />
  );
}
