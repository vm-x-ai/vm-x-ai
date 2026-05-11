'use client';

import { Delete as DeleteIcon, Edit as EditIcon } from '@mui/icons-material';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import { useTheme } from '@mui/material/styles';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import type { MRT_VisibilityState } from 'material-react-table';
import { useMrtTheme } from '@/hooks/use-mrt-theme';
import {
  MaterialReactTable,
  type MRT_ColumnDef,
  useMaterialReactTable,
} from 'material-react-table';
import Link from 'next/link';
import { useMemo, useState, useEffect } from 'react';
import ConfirmDeleteRoleDialog from './ConfirmDeleteDialog';
import { RoleDto } from '@/clients/api';
import { getRolesOptions } from '@/clients/api/@tanstack/react-query.gen';
import { useQuery } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';

export default function RoleTable() {
  const theme = useTheme();
  const { data, isLoading, refetch, error } = useQuery({
    ...getRolesOptions({}),
  });
  const [confirmDeleteItem, setConfirmDeleteItem] = useState<
    RoleDto | undefined
  >();
  const [columnVisibility, setColumnVisibility] = useState<MRT_VisibilityState>(
    {
      'mrt-row-expand': false,
      'mrt-row-select': false,
    }
  );

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const columns = useMemo<MRT_ColumnDef<RoleDto>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Role Name',
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
        accessorKey: 'membersCount',
        header: 'Members',
        size: 200,
        Cell: ({ row: { original: row } }) => (
          <Typography variant="inherit">{row.membersCount}</Typography>
        ),
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

  const mrtThemeProps = useMrtTheme();
  const table = useMaterialReactTable({
    columns,
    data: data || [],
    displayColumnDefOptions: { 'mrt-row-actions': { size: 120 } },
    enableFullScreenToggle: false,
    enableExpandAll: false,
    enableRowActions: true,
    enableEditing: false,
    enableColumnResizing: true,
    enableSorting: true,
    enableColumnActions: false,
    ...mrtThemeProps,
    muiTablePaperProps: {
      elevation: 0,
      ...mrtThemeProps.muiTablePaperProps,
    },
    renderRowActions: ({ row }) => (
      <Box sx={{ display: 'flex', gap: '1rem' }}>
        <Tooltip title="Edit">
          <IconButton
            LinkComponent={Link}
            href={`/settings/roles/edit/${row.original.roleId}`}
          >
            <EditIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Delete">
          <IconButton
            color="error"
            onClick={() => setConfirmDeleteItem(row.original)}
          >
            <DeleteIcon />
          </IconButton>
        </Tooltip>
      </Box>
    ),
    renderTopToolbarCustomActions: () => (
      <Button
        variant="outlined"
        LinkComponent={Link}
        href={`/settings/roles/new`}
      >
        Add new Role
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
      {confirmDeleteItem && (
        <ConfirmDeleteRoleDialog
          role={confirmDeleteItem}
          onClose={async () => {
            setConfirmDeleteItem(undefined);
            await refetch();
          }}
        />
      )}
    </>
  );
}
