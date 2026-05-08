'use client';

import { RequestUsageQueryResultDto } from '@/clients/api';
import { useMrtTheme } from '@/hooks/use-mrt-theme';
import {
  MaterialReactTable,
  type MRT_ColumnDef,
  useMaterialReactTable,
} from 'material-react-table';
import React, { useEffect, useState } from 'react';

export type BaseSummaryTableProps = {
  columns: MRT_ColumnDef<RequestUsageQueryResultDto>[];
  grouping?: string[];
  data: RequestUsageQueryResultDto[];
  autoRefresh?: boolean;
  autoRefreshInterval?: number;
  autoRefreshAction?: () => Promise<RequestUsageQueryResultDto[] | undefined>;
};

export function BaseSummaryTable({
  columns,
  grouping,
  data: rawData,
  autoRefresh,
  autoRefreshInterval,
  autoRefreshAction,
}: BaseSummaryTableProps) {
  const [data, setData] = useState<RequestUsageQueryResultDto[]>(rawData);
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

  const mrtThemeProps = useMrtTheme();
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
    ...mrtThemeProps,
    muiTablePaperProps: {
      elevation: 0,
      ...mrtThemeProps.muiTablePaperProps,
    },
  });

  return <MaterialReactTable table={table} />;
}
