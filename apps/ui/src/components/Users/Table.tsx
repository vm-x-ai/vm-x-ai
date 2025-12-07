'use client';

import { Delete as DeleteIcon, Edit as EditIcon } from '@mui/icons-material';
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
import { UserEntity } from '@/clients/api';
import { getUsersOptions } from '@/clients/api/@tanstack/react-query.gen';
import { useQuery } from '@tanstack/react-query';
import ConfirmDeleteUserDialog from './ConfirmDeleteDialog';
import Alert from '@mui/material/Alert';
import { useSession } from 'next-auth/react';
import Avatar from '@mui/material/Avatar';
import { stringToColor } from '@/utils/color';

function stringAvatar(name: string) {
  return {
    sx: {
      bgcolor: stringToColor(name),
    },
    children: `${name.split(' ')[0][0]}${name.split(' ')?.[1]?.[0] ?? ''}`,
  };
}

export default function UserTable() {
  const { data: session } = useSession();
  const theme = useTheme();
  const { data, isLoading, refetch, error } = useQuery({
    ...getUsersOptions({}),
  });

  const usersMap = useMemo(() => {
    return data?.reduce((acc, user) => {
      acc[user.id] = user;
      return acc;
    }, {} as Record<string, UserEntity>);
  }, [data]);

  const [confirmDeleteItem, setConfirmDeleteItem] = useState<
    UserEntity | undefined
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

  const columns = useMemo<MRT_ColumnDef<UserEntity>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'User Name',
        size: 200,
        Cell: ({ row }) => {
          return (
            <Box display="flex" alignItems="center" gap={1}>
              {row.original.pictureUrl ? (
                <Avatar src={row.original.pictureUrl} />
              ) : (
                <Avatar {...stringAvatar(row.original.name)} />
              )}
              <Typography
                variant="inherit"
                sx={{
                  color: theme.palette.primary.main,
                  fontWeight: 'bold',
                }}
              >
                {row.original.name}{' '}
                {session?.user?.userId === row.original.id && '(You)'}
              </Typography>
            </Box>
          );
        },
      },
      {
        accessorKey: 'email',
        header: 'Email',
      },
      {
        accessorKey: 'providerType',
        header: 'Authentication Provider',
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
        Cell: ({ row: { original: row } }) =>
          row.createdBy ? (
            <Typography variant="inherit">
              {usersMap?.[row.createdBy]?.name} (
              {usersMap?.[row.createdBy]?.email})
            </Typography>
          ) : (
            <Typography variant="inherit">-</Typography>
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
    [session?.user?.userId, theme.palette.primary.main, usersMap]
  );

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
    muiTablePaperProps: {
      elevation: 0,
    },
    renderRowActions: ({ row }) => (
      <Box sx={{ display: 'flex', gap: '1rem' }}>
        <Tooltip title="Edit">
          <IconButton
            LinkComponent={Link}
            href={`/settings/users/edit/${row.original.id}`}
          >
            <EditIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Delete">
          <IconButton
            color="error"
            disabled={session?.user?.userId === row.original.id}
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
        href={`/settings/users/new`}
      >
        Add new User
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
        <ConfirmDeleteUserDialog
          user={confirmDeleteItem}
          onClose={async () => {
            setConfirmDeleteItem(undefined);
            await refetch();
          }}
        />
      )}
    </>
  );
}
