'use client';

import { numberWithCommas } from '@/utils/number';
import type { MRT_ColumnDef } from 'material-react-table';
import React from 'react';
import { BaseSummaryTable } from './BaseSummaryTable';
import { CompletionUsageQueryResultDto } from '@/clients/api';

export type LLMTokenSummaryTableProps = {
  data: CompletionUsageQueryResultDto[];
  autoRefresh?: boolean;
  autoRefreshInterval?: number;
  autoRefreshAction?: () => Promise<
    CompletionUsageQueryResultDto[] | undefined
  >;
};

export function LLMTokenSummaryTable({
  data,
  autoRefresh,
  autoRefreshInterval,
  autoRefreshAction,
}: LLMTokenSummaryTableProps) {
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
      accessorKey: 'completionTokens',
      header: 'Completion Tokens',
      Cell: ({ row: { original: row } }) =>
        numberWithCommas((row.completionTokens as number) ?? 0),
    },
    {
      accessorKey: 'promptTokens',
      header: 'Prompt Tokens',
      Cell: ({ row: { original: row } }) =>
        numberWithCommas((row.promptTokens as number) ?? 0),
    },
    {
      accessorKey: 'totalTokens',
      header: 'Total Tokens',
      Cell: ({ row: { original: row } }) =>
        numberWithCommas((row.totalTokens as number) ?? 0),
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
