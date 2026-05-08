'use client';

import { formatCurrency } from '@/utils/number';
import type { MRT_ColumnDef } from 'material-react-table';
import React from 'react';
import { BaseSummaryTable } from './BaseSummaryTable';
import { RequestUsageQueryResultDto } from '@/clients/api';

export type LLMCostSummaryTableProps = {
  data: RequestUsageQueryResultDto[];
  autoRefresh?: boolean;
  autoRefreshInterval?: number;
  autoRefreshAction?: () => Promise<RequestUsageQueryResultDto[] | undefined>;
};

export function LLMCostSummaryTable({
  data,
  autoRefresh,
  autoRefreshInterval,
  autoRefreshAction,
}: LLMCostSummaryTableProps) {
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
      accessorKey: 'inputCost',
      header: 'Input Cost',
      Cell: ({ row: { original: row } }) =>
        formatCurrency((row.inputCost as number) ?? 0),
    },
    {
      accessorKey: 'outputCost',
      header: 'Output Cost',
      Cell: ({ row: { original: row } }) =>
        formatCurrency((row.outputCost as number) ?? 0),
    },
    {
      accessorKey: 'cachedCost',
      header: 'Cached Cost',
      Cell: ({ row: { original: row } }) =>
        formatCurrency((row.cachedCost as number) ?? 0),
    },
    {
      accessorKey: 'reasoningCost',
      header: 'Reasoning Cost',
      Cell: ({ row: { original: row } }) =>
        formatCurrency((row.reasoningCost as number) ?? 0),
    },
    {
      accessorKey: 'totalCost',
      header: 'Total Cost',
      Cell: ({ row: { original: row } }) =>
        formatCurrency((row.totalCost as number) ?? 0),
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
