'use client';

import React from 'react';
import { BaseSummaryTable } from './BaseSummaryTable';
import { CompletionUsageQueryResultDto } from '@/clients/api';

export type Top10TokenPerSecondTableProps = {
  data: CompletionUsageQueryResultDto[];
  autoRefresh: boolean;
  autoRefreshInterval?: number;
  autoRefreshAction?: () => Promise<
    CompletionUsageQueryResultDto[] | undefined
  >;
};

export function Top10TokenPerSecondTable({
  data,
  autoRefresh,
  autoRefreshInterval,
  autoRefreshAction,
}: Top10TokenPerSecondTableProps) {
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
          accessorKey: 'tokensPerSecond',
          header: 'Average ms',
          enableGrouping: false,
          Cell: ({ row: { original: row } }) =>
            ((row.tokensPerSecond as number) ?? 0).toFixed(2),
        },
      ]}
      data={data}
      autoRefresh={autoRefresh}
      autoRefreshInterval={autoRefreshInterval}
      autoRefreshAction={autoRefreshAction}
    />
  );
}
