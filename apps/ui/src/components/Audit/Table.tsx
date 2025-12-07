'use client';

import AddIcon from '@mui/icons-material/Add';
import MinusIcon from '@mui/icons-material/Remove';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import MUILink from '@mui/material/Link';
import { useTheme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import type { Updater } from '@tanstack/react-query';
import type {
  MRT_VisibilityState,
  MRT_PaginationState,
} from 'material-react-table';
import {
  MaterialReactTable,
  type MRT_ColumnDef,
  useMaterialReactTable,
} from 'material-react-table';
import Image from 'next/image';
import Link from 'next/link';
import { useQueryState, parseAsInteger } from 'nuqs';
import { useEffect, useMemo, useState } from 'react';
import AuditDetail from './AuditDetails';
import AuditHeader from './Header';
import {
  AiConnectionEntity,
  AiProviderDto,
  AiResourceEntity,
  ApiKeyEntity,
  CompletionAuditEntity,
  ListAuditResponseDto,
} from '@/clients/api';
import { getReasonPhrase } from 'http-status-codes';

export type AuditTableProps = {
  workspaceId?: string;
  environmentId?: string;
  data?: ListAuditResponseDto;
  loading?: boolean;
  resourcesMap?: Record<string, AiResourceEntity>;
  aiConnectionMap?: Record<string, AiConnectionEntity>;
  providersMap?: Record<string, AiProviderDto>;
  apiKeysMap?: Record<string, ApiKeyEntity>;
};

export default function AuditTable({
  loading = false,
  workspaceId,
  environmentId,
  data,
  resourcesMap,
  aiConnectionMap,
  providersMap,
  apiKeysMap,
}: AuditTableProps) {
  const [pageSize, setPageSize] = useQueryState(
    'pageSize',
    parseAsInteger.withDefault(100).withOptions({
      history: 'push',
      shallow: false,
    })
  );
  const [pageIndex, setPageIndex] = useQueryState(
    'pageIndex',
    parseAsInteger.withDefault(0).withOptions({
      history: 'push',
      shallow: false,
    })
  );
  const [showProgressBars, setShowProgressBar] = useState<boolean>(false);

  const theme = useTheme();
  const [columnVisibility, setColumnVisibility] = useState<MRT_VisibilityState>(
    {
      'mrt-row-expand': true,
      'mrt-row-select': false,
    }
  );

  const [pagination, setPagination] = useState<MRT_PaginationState>({
    pageIndex,
    pageSize,
  });

  const handleSetPagination = (
    updater: Updater<MRT_PaginationState, MRT_PaginationState>
  ) => {
    const newValue =
      typeof updater === 'function' ? updater(pagination) : updater;

    setPageIndex(newValue.pageIndex);
    setPagination(newValue);
    setShowProgressBar(true);
  };

  useEffect(() => {
    setPageSize(pagination.pageSize);
  }, [pagination.pageSize, setPageSize]);

  useEffect(() => {
    setShowProgressBar(false);
  }, [data]);

  const columns = useMemo<MRT_ColumnDef<CompletionAuditEntity>[]>(
    () => [
      {
        accessorKey: 'timestamp',
        header: 'Timestamp',
        size: 200,
        Cell: ({ row }) => {
          return (
            <Typography
              variant="inherit"
              sx={{
                color: theme.palette.primary.main,
                fontWeight: 'bold',
              }}
            >
              {row.original.timestamp?.split('|')?.[0]}
            </Typography>
          );
        },
      },
      {
        accessorKey: 'correlationId',
        header: 'Correlation ID',
      },
      {
        header: 'Routed To',
        size: 300,
        Cell: ({ row: { original: row } }) =>
          row.connectionId && providersMap && aiConnectionMap ? (
            <Chip
              key={row.connectionId}
              label={
                (aiConnectionMap[row.connectionId]
                  ? `${
                      providersMap[aiConnectionMap[row.connectionId]?.provider]
                        ?.name
                    }`
                  : `${row.connectionId} (Deleted)`) + ` - ${row.model}`
              }
              icon={
                <Box>
                  {aiConnectionMap[row.connectionId] && (
                    <Image
                      alt={
                        providersMap[aiConnectionMap[row.connectionId].provider]
                          ?.name
                      }
                      src={
                        providersMap[aiConnectionMap[row.connectionId].provider]
                          ?.config.logo.url
                      }
                      height={20}
                      width={20}
                    />
                  )}
                </Box>
              }
            />
          ) : (
            <Chip label="Unkown" />
          ),
      },
      {
        accessorKey: 'duration',
        header: 'Duration (ms)',
      },
      {
        accessorKey: 'sourceIp',
        header: 'Source IP',
      },
      {
        accessorKey: 'resourceId',
        header: 'Resource',
        Cell: ({ row: { original: row } }) =>
          row.resourceId && resourcesMap?.[row.resourceId] ? (
            <MUILink
              component={Link}
              href={`/workspaces/${workspaceId}/${environmentId}/ai-resources/edit/${row.resourceId}/general`}
              variant="body2"
            >
              {resourcesMap?.[row.resourceId]?.name ?? row.resourceId}
            </MUILink>
          ) : (
            <Typography variant="body2">
              {row.resourceId ? `${row.resourceId} (Deleted)` : '-'}
            </Typography>
          ),
      },
      {
        accessorKey: 'statusCode',
        header: 'Status Code',
        size: 300,
        Cell: ({ row: { original: row } }) => (
          <Chip
            key={row.statusCode}
            size="small"
            color={row.statusCode > 399 ? 'error' : 'success'}
            label={`${row.statusCode} ${getReasonPhrase(row.statusCode)}`}
          />
        ),
      },
      {
        header: 'Role',
        Cell: ({ row: { original: row } }) =>
          row.apiKeyId ? (
            <Box
              sx={{
                display: 'flex',
                gap: theme.spacing(1),
              }}
            >
              <MUILink
                component={Link}
                href={`/workspaces/${workspaceId}/${environmentId}/security/auth/role/edit/${row.apiKeyId}/general`}
                variant="body2"
              >
                {apiKeysMap?.[row.apiKeyId]?.name}
              </MUILink>
            </Box>
          ) : (
            '-'
          ),
      },
      {
        header: 'Role Groups',
        Cell: ({ row: { original: row } }) =>
          row.apiKeyId ? (
            <Box
              sx={{
                display: 'flex',
                gap: theme.spacing(1),
              }}
            >
              {apiKeysMap?.[row.apiKeyId]?.labels?.map((label) => (
                <Chip key={label} size="small" color="primary" label={label} />
              ))}
            </Box>
          ) : (
            '-'
          ),
      },
      {
        accessorKey: 'failureReason',
        header: 'Failure Reason',
      },
    ],
    [
      aiConnectionMap,
      apiKeysMap,
      environmentId,
      providersMap,
      resourcesMap,
      theme,
      workspaceId,
    ]
  );

  const table = useMaterialReactTable({
    columns,
    data: data?.data || [],
    enableFullScreenToggle: false,
    enableExpandAll: false,
    enableRowActions: false,
    enableEditing: false,
    enableColumnResizing: false,
    enableSorting: false,
    enableColumnActions: false,
    enableFilters: false,
    enableStickyHeader: true,
    enableStickyFooter: true,
    muiTablePaperProps: {
      elevation: 0,
    },
    state: {
      isLoading: loading,
      columnVisibility,
      pagination,
      showProgressBars,
    },
    muiExpandButtonProps: ({ row }) => ({
      children: row.getIsExpanded() ? <MinusIcon /> : <AddIcon />,
    }),
    onPaginationChange: handleSetPagination,
    onColumnVisibilityChange: setColumnVisibility,
    renderTopToolbar: () => (
      <Box
        sx={{
          paddingTop: theme.spacing(2),
        }}
      >
        <AuditHeader
          providersMap={providersMap}
          resourcesMap={resourcesMap}
          aiConnectionMap={aiConnectionMap}
        />
      </Box>
    ),
    renderDetailPanel: ({ row }) => <AuditDetail data={row.original} />,
    rowCount: data?.total ?? 0,
    manualPagination: true,
    muiTableContainerProps: { sx: { maxHeight: 'calc(100vh - 26rem)' } },
    muiPaginationProps: {
      rowsPerPageOptions: [5, 10, 20, 50, 100, 200, 500],
    },
  });

  return <MaterialReactTable table={table} />;
}
