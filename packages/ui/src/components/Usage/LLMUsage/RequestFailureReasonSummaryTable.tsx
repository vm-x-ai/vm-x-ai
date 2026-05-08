'use client';

import { numberWithCommas } from '@/utils/number';
import { RequestUsageQueryResultDto } from '@/clients/api';
import type { MRT_ColumnDef } from 'material-react-table';
import React from 'react';
import { BaseSummaryTable } from './BaseSummaryTable';

export type LLMRequestFailureReasonSummaryTableProps = {
  data: RequestUsageQueryResultDto[];
  autoRefresh?: boolean;
  autoRefreshInterval?: number;
  autoRefreshAction?: () => Promise<RequestUsageQueryResultDto[] | undefined>;
};

export function LLMRequestFailureReasonSummaryTable({
  data,
  autoRefresh,
  autoRefreshInterval,
  autoRefreshAction,
}: LLMRequestFailureReasonSummaryTableProps) {
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
      accessorKey: 'failureReason',
      header: 'Reason',
    },
    {
      accessorKey: 'errorCount',
      header: 'Count',
      Cell: ({ row: { original: row } }) =>
        numberWithCommas((row.errorCount as number) ?? 0),
    },
  ];

  return (
    <BaseSummaryTable
      columns={columns}
      data={data}
      grouping={['failureReason']}
      autoRefresh={autoRefresh}
      autoRefreshInterval={autoRefreshInterval}
      autoRefreshAction={autoRefreshAction}
    />
  );
}
