'use client';

import { formatDuration } from '@/utils/time';
import type { MRT_ColumnDef } from 'material-react-table';
import React from 'react';
import { BaseSummaryTable } from './BaseSummaryTable';
import { CompletionUsageQueryResultDto } from '@/clients/api';

export type LLMRequestLatencySummaryTableProps = {
  data: CompletionUsageQueryResultDto[];
  autoRefresh?: boolean;
  autoRefreshInterval?: number;
  autoRefreshAction?: () => Promise<
    CompletionUsageQueryResultDto[] | undefined
  >;
};

export function LLMRequestLatencySummaryTable({
  data,
  autoRefresh,
  autoRefreshInterval,
  autoRefreshAction,
}: LLMRequestLatencySummaryTableProps) {
  const columns: MRT_ColumnDef<CompletionUsageQueryResultDto>[] = [
    {
      accessorKey: 'resourceId.displayName',
      header: 'Resource',
    },
    {
      accessorKey: 'provider.displayName',
      header: 'Provider',
    },
    {
      accessorKey: 'connectionId.displayName',
      header: 'AI Connection',
    },
    {
      accessorKey: 'model',
      header: 'Model',
    },
    {
      accessorKey: 'requestDuration',
      header: 'Duration (p99)',
      Cell: ({ row: { original: row } }) =>
        formatDuration((row.requestDuration as number) ?? 0),
    },
  ];

  return (
    <BaseSummaryTable
      columns={columns}
      data={data}
      grouping={['resource.displayName']}
      autoRefresh={autoRefresh}
      autoRefreshInterval={autoRefreshInterval}
      autoRefreshAction={autoRefreshAction}
    />
  );
}
