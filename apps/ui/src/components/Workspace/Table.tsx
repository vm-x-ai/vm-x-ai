'use client';

import {
  Add as AddIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
} from '@mui/icons-material';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import { useTheme } from '@mui/material/styles';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import type { MRT_VisibilityState } from 'material-react-table';
import {
  MaterialReactTable,
  type MRT_ColumnDef,
  useMaterialReactTable,
} from 'material-react-table';
import Link from 'next/link';
import { useMemo, useState, useEffect } from 'react';
import ConfirmDeleteWorkspaceDialog from './ConfirmDeleteDialog';
import ConfirmDeleteEnvironmentDialog from '../Environment/ConfirmDeleteDialog';
import { EnvironmentEntity, WorkspaceEntity } from '@/clients/api';
import { getWorkspacesOptions } from '@/clients/api/@tanstack/react-query.gen';
import { useQuery } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import { useRouter } from 'next/navigation';

export type WorkspaceTableProps = {
  workspaces: WorkspaceEntity[];
};

function isEnvironment(
  row: WorkspaceEntity | EnvironmentEntity
): row is EnvironmentEntity {
  return 'environmentId' in row;
}

export default function WorkspaceTable({
  workspaces: initialWorkspaces,
}: WorkspaceTableProps) {
  const theme = useTheme();
  const { data, isLoading, refetch, error } = useQuery({
    ...getWorkspacesOptions({
      query: {
        includesEnvironments: true,
      },
    }),
    initialData: initialWorkspaces,
  });
  const router = useRouter();
  const [confirmDeleteWorkspace, setConfirmDeleteWorkspace] = useState<
    WorkspaceEntity | undefined
  >();
  const [confirmDeleteEnvironment, setConfirmDeleteEnvironment] = useState<
    EnvironmentEntity | undefined
  >();
  const [columnVisibility, setColumnVisibility] = useState<MRT_VisibilityState>(
    {
      'mrt-row-expand': true,
      'mrt-row-select': false,
    }
  );

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const columns = useMemo<MRT_ColumnDef<WorkspaceEntity | EnvironmentEntity>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Name',
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
              {row.original.name}
            </Typography>
          );
        },
      },
      {
        accessorKey: 'description',
        header: 'Description',
      },
      {
        accessorKey: 'createdAt',
        header: 'Created At',
        size: 300,
        Cell: ({ row: { original: row } }) => (
          <Typography variant="inherit">
            {new Date(row.createdAt).toLocaleString()}
          </Typography>
        ),
      },
      {
        accessorKey: 'createdBy',
        header: 'Created By',
        size: 300,
        Cell: ({ row: { original: row } }) => (
          <Typography variant="inherit">
            {row.createdByUser?.name} ({row.createdByUser?.email})
          </Typography>
        ),
      },
      {
        accessorKey: 'updatedAt',
        header: 'Updated At',
        size: 300,
        Cell: ({ row: { original: row } }) => (
          <Typography variant="inherit">
            {new Date(row.updatedAt).toLocaleString()}
          </Typography>
        ),
      },
    ],
    [theme.palette.primary.main]
  );

  const table = useMaterialReactTable({
    columns,
    data: data || [],
    displayColumnDefOptions: { 'mrt-row-actions': { size: 180 } },
    enableFullScreenToggle: false,
    enableExpandAll: true,
    enableRowActions: true,
    enableEditing: false,
    enableColumnResizing: true,
    enableSorting: true,
    enableColumnActions: false,
    enableExpanding: true,
    muiTablePaperProps: {
      elevation: 0,
    },
    getSubRows: (row) => ('environments' in row ? row.environments || [] : []),
    renderRowActions: ({ row }) => (
      <Box sx={{ display: 'flex', gap: '1rem' }}>
        <Tooltip title="Create Environment">
          <IconButton
            LinkComponent={Link}
            href={`/getting-started?workspaceId=${row.original.workspaceId}`}
            onClick={(event) => {
              event.stopPropagation();
            }}
            disabled={isEnvironment(row.original)}
            sx={{
              opacity: !isEnvironment(row.original) ? 1 : 0,
            }}
          >
            <AddIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Edit">
          <IconButton
            LinkComponent={Link}
            href={
              isEnvironment(row.original)
                ? `/workspaces/${row.original.workspaceId}/${row.original.environmentId}/edit`
                : `/workspaces/${row.original.workspaceId}/edit`
            }
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <EditIcon />
          </IconButton>
        </Tooltip>

        <Tooltip title="Delete">
          <IconButton
            color="error"
            onClick={(event) => {
              event.stopPropagation();
              if (isEnvironment(row.original)) {
                setConfirmDeleteEnvironment(row.original);
              } else {
                setConfirmDeleteWorkspace(row.original);
              }
            }}
          >
            <DeleteIcon />
          </IconButton>
        </Tooltip>
      </Box>
    ),
    muiTableBodyRowProps: ({ row }) => ({
      onClick: () => {
        router.push(
          isEnvironment(row.original)
            ? `/workspaces/${row.original.workspaceId}/${row.original.environmentId}`
            : `/workspaces/${row.original.workspaceId}`
        );
      },
      sx: (theme) => ({
        cursor: 'pointer',
        '&:hover': {
          backgroundColor: `${theme.palette.secondary.light} !important`,
        },
        '&.Mui-selected': {
          backgroundColor: `${theme.palette.secondary.light} !important`,
        },
      }),
    }),
    renderTopToolbarCustomActions: () => (
      <Button variant="outlined" LinkComponent={Link} href={`/getting-started`}>
        Add new Workspace
      </Button>
    ),
    state: {
      isLoading: isLoading,
      columnVisibility,
    },
    onColumnVisibilityChange: setColumnVisibility,
  });

  return (
    <>
      {error && (
        <Alert severity="error">
          Failed to fetch roles: {error.errorMessage}
        </Alert>
      )}
      <MaterialReactTable table={table} />
      {confirmDeleteWorkspace && (
        <ConfirmDeleteWorkspaceDialog
          workspace={confirmDeleteWorkspace}
          onClose={async () => {
            setConfirmDeleteWorkspace(undefined);
            await refetch();
          }}
        />
      )}
      {confirmDeleteEnvironment && (
        <ConfirmDeleteEnvironmentDialog
          environment={confirmDeleteEnvironment}
          onClose={async () => {
            setConfirmDeleteEnvironment(undefined);
            await refetch();
          }}
        />
      )}
    </>
  );
}
