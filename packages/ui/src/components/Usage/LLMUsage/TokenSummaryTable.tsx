'use client';

import { numberWithCommas } from '@/utils/number';
import type { MRT_ColumnDef } from 'material-react-table';
import React from 'react';
import { BaseSummaryTable } from './BaseSummaryTable';
import { RequestUsageQueryResultDto } from '@/clients/api';

export type LLMTokenSummaryTableProps = {
  data: RequestUsageQueryResultDto[];
  autoRefresh?: boolean;
  autoRefreshInterval?: number;
  autoRefreshAction?: () => Promise<RequestUsageQueryResultDto[] | undefined>;
};

export function LLMTokenSummaryTable({
  data,
  autoRefresh,
  autoRefreshInterval,
  autoRefreshAction,
}: LLMTokenSummaryTableProps) {
  const columns: MRT_ColumnDef<RequestUsageQueryResultDto>[] = [
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
      accessorKey: 'outputTokens',
      header: 'Output Tokens',
      Cell: ({ row: { original: row } }) =>
        numberWithCommas((row.outputTokens as number) ?? 0),
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
