'use client';

import { numberWithCommas } from '@/utils/number';
import type { MRT_ColumnDef } from 'material-react-table';
import React from 'react';
import { BaseSummaryTable } from './BaseSummaryTable';
import { CompletionUsageQueryResultDto } from '@/clients/api';

export type LLMRequestSummaryTableProps = {
  data: CompletionUsageQueryResultDto[];
  autoRefresh?: boolean;
  autoRefreshInterval?: number;
  autoRefreshAction?: () => Promise<
    CompletionUsageQueryResultDto[] | undefined
  >;
};

export function LLMRequestSummaryTable({
  data,
  autoRefresh,
  autoRefreshInterval,
  autoRefreshAction,
}: LLMRequestSummaryTableProps) {
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
      accessorKey: 'success',
      header: 'Success',
      Cell: ({ row: { original: row } }) =>
        numberWithCommas((row.successCount as number) ?? 0),
    },
    {
      accessorKey: 'error',
      header: 'Error',
      Cell: ({ row: { original: row } }) =>
        numberWithCommas((row.errorCount as number) ?? 0),
    },
  ];

  return (
    <BaseSummaryTable
      columns={columns}
      data={data}
      grouping={['provider.displayName']}
      autoRefresh={autoRefresh}
      autoRefreshInterval={autoRefreshInterval}
      autoRefreshAction={autoRefreshAction}
    />
  );
}
