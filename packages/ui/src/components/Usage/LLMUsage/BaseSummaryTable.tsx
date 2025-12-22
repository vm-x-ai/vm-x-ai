'use client';

import { CompletionUsageQueryResultDto } from '@/clients/api';
import {
  MaterialReactTable,
  type MRT_ColumnDef,
  useMaterialReactTable,
} from 'material-react-table';
import React, { useEffect, useState } from 'react';

export type BaseSummaryTableProps = {
  columns: MRT_ColumnDef<CompletionUsageQueryResultDto>[];
  grouping?: string[];
  data: CompletionUsageQueryResultDto[];
  autoRefresh?: boolean;
  autoRefreshInterval?: number;
  autoRefreshAction?: () => Promise<
    CompletionUsageQueryResultDto[] | undefined
  >;
};

export function BaseSummaryTable({
  columns,
  grouping,
  data: rawData,
  autoRefresh,
  autoRefreshInterval,
  autoRefreshAction,
}: BaseSummaryTableProps) {
  const [data, setData] = useState<CompletionUsageQueryResultDto[]>(rawData);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    setData(rawData);
  }, [rawData]);

  useEffect(() => {
    if (autoRefresh && autoRefreshInterval && autoRefreshAction) {
      const interval = setInterval(async () => {
        if (loading) {
          return;
        }

        setLoading(true);
        try {
          const newData = await autoRefreshAction();
          if (newData) {
            setData(newData);
          }
        } finally {
          setLoading(false);
        }
      }, autoRefreshInterval);

      return () => {
        clearInterval(interval);
      };
    }

    return () => {
      // do nothing
    };
  }, [autoRefresh, autoRefreshInterval, autoRefreshAction, loading]);

  const table = useMaterialReactTable({
    columns,
    data,
    enablePagination: false,
    enableFullScreenToggle: false,
    enableBottomToolbar: false,
    enableGrouping: true,
    initialState: {
      density: 'compact',
      grouping,
      expanded: true,
    },
    muiTablePaperProps: {
      elevation: 0,
    },
  });

  return <MaterialReactTable table={table} />;
}
