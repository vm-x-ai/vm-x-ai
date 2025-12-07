'use client';

import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import MUILink from '@mui/material/Link';
import Tooltip from '@mui/material/Tooltip';
import type {
  MRT_ExpandedState,
  MRT_VisibilityState,
} from 'material-react-table';
import {
  MRT_ExpandButton,
  MaterialReactTable,
  useMaterialReactTable,
  type MRT_ColumnDef,
} from 'material-react-table';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import ConfirmDeleteAPIKeyDialog from './ConfirmDeleteDialog';
import { AiResourceEntity, ApiKeyEntity } from '@/clients/api';
import { useQuery } from '@tanstack/react-query';
import { getApiKeysOptions } from '@/clients/api/@tanstack/react-query.gen';

export type APIKeysTableProps = {
  workspaceId?: string;
  environmentId?: string;
  data?: ApiKeyEntity[];
  resourcesMap?: Record<string, AiResourceEntity>;
  loading?: boolean;
};

export default function APIKeysTable({
  loading: initialLoading = false,
  data: initialData,
  workspaceId,
  environmentId,
  resourcesMap,
}: APIKeysTableProps) {
  const { data, isLoading, refetch } = useQuery({
    ...getApiKeysOptions({
      path: {
        workspaceId: workspaceId as string,
        environmentId: environmentId as string,
      },
    }),
    enabled: !!workspaceId && !!environmentId,
    initialData: initialData,
  });
  const loading = useMemo(() => initialLoading || isLoading, [initialLoading, isLoading]);

  const [confirmDeleteItem, setConfirmDeleteItem] = useState<
    ApiKeyEntity | undefined
  >();
  const [columnVisibility, setColumnVisibility] = useState<MRT_VisibilityState>(
    {}
  );

  const columns = useMemo<MRT_ColumnDef<ApiKeyEntity>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Role Name',
        Cell: ({ row }) => (
          <MUILink
            component={Link}
            href={`/workspaces/${workspaceId}/${environmentId}/security/auth/role/edit/${row.original.apiKeyId}/general`}
            variant="body2"
          >
            {row.original.name}
          </MUILink>
        ),
      },
      {
        accessorKey: 'description',
        header: 'Description',
      },
      {
        accessorKey: 'maskedKey',
        header: 'API Key',
        enableEditing: false,
      },
      {
        accessorKey: 'enabled',
        header: 'Enabled',
      },
      {
        accessorKey: 'labels',
        header: 'Groups',
        size: 200,
        Cell: ({ row: { original: row } }) => (
          <Box
            sx={{
              display: 'flex',
              gap: '.5rem',
            }}
          >
            {row.labels?.map((label) => (
              <Chip key={label} color="primary" label={label} size="small" />
            ))}
          </Box>
        ),
      },
      {
        accessorKey: 'resources',
        header: 'Resources',
        size: 300,
        Cell: ({ row: { original: row } }) => (
          <Box
            sx={{
              display: 'flex',
              gap: '.5rem',
            }}
          >
            {row.resources?.map((resource) => (
              <Chip
                key={resource}
                label={resourcesMap?.[resource]?.name ?? resource}
                size="small"
              />
            ))}
          </Box>
        ),
      },
    ],
    [environmentId, workspaceId, resourcesMap]
  );

  const initialExpandedRootRows = useMemo<MRT_ExpandedState>(
    () =>
      data
        ? data
            .map((row) => row.labels)
            .reduce(
              (a, v) => (v ? { ...a, [`labels:${v.join(',')}`]: true } : a),
              {}
            )
        : {},
    [data]
  );

  const table = useMaterialReactTable({
    columns,
    data: data ?? [],
    enableFullScreenToggle: false,
    enableExpandAll: false,
    enableRowActions: true,
    enableGrouping: true,
    positionToolbarAlertBanner: 'bottom',
    muiTablePaperProps: {
      elevation: 0,
    },
    getRowId: (row) => row.apiKeyId,
    displayColumnDefOptions: {
      'mrt-row-expand': {
        Cell: ({ row, table }) => {
          if (row.groupingValue) {
            return <MRT_ExpandButton row={row} table={table} />;
          }

          return <></>;
        },
      },
    },
    renderTopToolbarCustomActions: () => (
      <Box sx={{ display: 'flex', gap: '1rem', p: '4px' }}>
        <Button
          color="primary"
          variant="outlined"
          LinkComponent={Link}
          href={`/workspaces/${workspaceId}/${environmentId}/security/auth/role/new`}
          startIcon={<AddIcon />}
        >
          Add Role
        </Button>
      </Box>
    ),
    renderRowActions: ({ row }) => (
      <Box sx={{ display: 'flex', gap: '1rem' }}>
        <Tooltip title="Edit">
          <IconButton
            LinkComponent={Link}
            href={`/workspaces/${workspaceId}/${environmentId}/security/auth/role/edit/${row.original.apiKeyId}/general`}
          >
            <EditIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Delete">
          <IconButton
            color="error"
            onClick={() => {
              setConfirmDeleteItem(row.original);
            }}
          >
            <DeleteIcon />
          </IconButton>
        </Tooltip>
      </Box>
    ),
    initialState: {
      expanded: initialExpandedRootRows,
      grouping: ['labels'],
    },
    state: {
      isLoading: loading,
      columnVisibility,
    },
    onColumnVisibilityChange: setColumnVisibility,
  });

  return (
    <>
      <MaterialReactTable table={table} />
      {workspaceId && environmentId && confirmDeleteItem && (
        <ConfirmDeleteAPIKeyDialog
          apiKey={confirmDeleteItem}
          workspaceId={workspaceId}
          environmentId={environmentId}
          onClose={async () => {
            await refetch();
            setConfirmDeleteItem(undefined);
          }}
        />
      )}
    </>
  );
}
