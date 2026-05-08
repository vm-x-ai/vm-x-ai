'use client';

import type { MRT_VisibilityState } from 'material-react-table';
import { useMrtTheme } from '@/hooks/use-mrt-theme';
import {
  MaterialReactTable,
  type MRT_ColumnDef,
  useMaterialReactTable,
} from 'material-react-table';
import { useMemo, useState, useEffect } from 'react';
import { UserEntity, WorkspaceUserDto, WorkspaceUserRole } from '@/clients/api';
import Typography from '@mui/material/Typography';
import { useQuery } from '@tanstack/react-query';
import { getUsersOptions } from '@/clients/api/@tanstack/react-query.gen';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import IconButton from '@mui/material/IconButton';
import DeleteIcon from '@mui/icons-material/Delete';
import { useSession } from 'next-auth/react';
import EditIcon from '@mui/icons-material/Edit';
import { MemberSchema } from './schema';

export type MembersTableProps = {
  value?: MemberSchema[] | null;
  onAddMember: (member: MemberSchema) => void;
  onRemoveMember: (member: MemberSchema) => void;
  onUpdateMemberRole: (member: MemberSchema) => void;
};

const validateRequired = (value: string) => !!value.length;

export default function MembersTable({
  value,
  onAddMember,
  onRemoveMember,
  onUpdateMemberRole,
}: MembersTableProps) {
  const { data: session } = useSession();
  const { data: users, isLoading } = useQuery({
    ...getUsersOptions({}),
  });

  const availableUsers = useMemo(() => {
    return users?.filter((user) => !value?.some((m) => m.userId === user.id));
  }, [users, value]);

  const usersMap = useMemo(() => {
    return users?.reduce((acc, user) => {
      acc[user.id] = user;
      return acc;
    }, {} as Record<string, UserEntity>);
  }, [users]);

  const [validationErrors, setValidationErrors] = useState<
    Record<string, string | undefined>
  >({});

  const [columnVisibility, setColumnVisibility] = useState<MRT_VisibilityState>(
    {
      'mrt-row-expand': false,
      'mrt-row-select': false,
    }
  );

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const columns = useMemo<MRT_ColumnDef<MemberSchema>[]>(
    () => [
      {
        accessorKey: 'user.name',
        header: 'User Name',
        Cell: ({ row }) => {
          return (
            <Typography variant="inherit">
              {usersMap?.[row.original.userId]?.name} (
              {usersMap?.[row.original.userId]?.email}){' '}
              {session?.user?.userId === row.original.userId && '(You)'}
            </Typography>
          );
        },
        enableEditing(row) {
          return !row.original.addedBy;
        },
        Edit({ row: { original: row, index }, column }) {
          return (
            <Autocomplete
              options={availableUsers ?? []}
              fullWidth
              value={row?.userId ? usersMap?.[row.userId] : null}
              getOptionLabel={(option) => `${option.name} (${option.email})`}
              onChange={(_, newValue) => {
                const selectedValue = newValue;
                const validationError = !validateRequired(
                  selectedValue?.id ?? ''
                )
                  ? 'User is required'
                  : undefined;
                setValidationErrors({
                  ...validationErrors,
                  [column.id]: validationError,
                });

                row.userId = selectedValue?.id ?? '';
                row.role = WorkspaceUserRole.MEMBER;
                row.addedAt = new Date().toISOString();
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  variant="standard"
                  margin="none"
                  size="small"
                  slotProps={{
                    ...params.slotProps,

                    input: {
                      ...(params.slotProps.input ?? {}),
                      disableUnderline: true,
                      autoComplete: 'off',
                      sx: {
                        mb: 0,
                      },
                    },

                    select: {
                      MenuProps: {
                        disableScrollLock: true,
                      },
                    },
                  }}
                  error={!!validationErrors?.[column.id]}
                  helperText={validationErrors?.[column.id]}
                />
              )}
            />
          );
        },
      },
      {
        accessorKey: 'role',
        header: 'Role',
        Cell: ({ row }) => {
          return <Typography variant="inherit">{row.original.role}</Typography>;
        },
        Edit({ row: { original: row, index }, column }) {
          return (
            <Autocomplete
              options={Object.values(WorkspaceUserRole) ?? []}
              fullWidth
              value={row?.role ? (row.role as WorkspaceUserRole) : null}
              onChange={(_, newValue) => {
                const selectedValue = newValue;
                const validationError = !validateRequired(selectedValue ?? '')
                  ? 'Role is required'
                  : undefined;
                setValidationErrors({
                  ...validationErrors,
                  [column.id]: validationError,
                });

                row.role = selectedValue as WorkspaceUserRole;
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  variant="standard"
                  margin="none"
                  size="small"
                  slotProps={{
                    ...params.slotProps,

                    input: {
                      ...(params.slotProps.input ?? {}),
                      disableUnderline: true,
                      autoComplete: 'off',
                      sx: {
                        mb: 0,
                      },
                    },

                    select: {
                      MenuProps: {
                        disableScrollLock: true,
                      },
                    },
                  }}
                  error={!!validationErrors?.[column.id]}
                  helperText={validationErrors?.[column.id]}
                />
              )}
            />
          );
        },
      },
      {
        accessorKey: 'addedAt',
        header: 'Added At',
        enableEditing: false,
        Cell: ({ row }) =>
          row.original.addedAt && row.original.addedBy !== null ? (
            <Typography variant="inherit">
              {new Date(row.original.addedAt).toLocaleString()}
            </Typography>
          ) : (
            <Typography variant="inherit">Not assigned yet</Typography>
          ),
      },
      {
        accessorKey: 'addedByUser.name',
        header: 'Added By',
        enableEditing: false,
        Cell: ({ row }) =>
          row.original.addedBy ? (
            <Typography variant="inherit">
              {usersMap?.[row.original.addedBy]?.name} (
              {usersMap?.[row.original.addedBy]?.email})
            </Typography>
          ) : (
            <Typography variant="inherit">Not assigned yet</Typography>
          ),
      },
    ],
    [availableUsers, session?.user?.userId, usersMap, validationErrors]
  );

  const mrtThemeProps = useMrtTheme();
  const table = useMaterialReactTable({
    columns,
    data: value || [],
    displayColumnDefOptions: { 'mrt-row-actions': { size: 120 } },
    enableFullScreenToggle: false,
    enableExpandAll: false,
    enableRowActions: true,
    enableEditing: true,
    enablePagination: false,
    ...mrtThemeProps,
    muiTablePaperProps: {
      elevation: 0,
      ...mrtThemeProps.muiTablePaperProps,
    },
    muiTableContainerProps: { sx: { maxHeight: '500px' } },
    createDisplayMode: 'row',
    editDisplayMode: 'row',
    positionCreatingRow: 'bottom',
    state: {
      columnVisibility,
      isLoading,
    },
    localization: {
      noRecordsToDisplay: 'No members found',
    },
    onColumnVisibilityChange: setColumnVisibility,
    renderTopToolbarCustomActions: ({ table }) => (
      <Box
        sx={{
          display: 'flex',
          gap: '1rem',
        }}
      >
        <Button
          variant="contained"
          size="small"
          onClick={() => {
            table.setCreatingRow(true);
          }}
        >
          Add Member
        </Button>
      </Box>
    ),
    onCreatingRowCancel: () => setValidationErrors({}),
    renderRowActions: ({ row, table }) => (
      <Box sx={{ display: 'flex', gap: '1rem' }}>
        <Tooltip title="Delete">
          <span>
            <IconButton
              color="error"
              onClick={() =>
                onRemoveMember({
                  userId: row.original.userId,
                  role: row.original.role,
                })
              }
            >
              <DeleteIcon />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Edit">
          <span>
            <IconButton
              color="secondary"
              onClick={() => table.setEditingRow(row)}
            >
              <EditIcon />
            </IconButton>
          </span>
        </Tooltip>
      </Box>
    ),
    onCreatingRowSave: async ({ table, row: { original: row } }) => {
      if (Object.keys(validationErrors).some((key) => validationErrors[key])) {
        return;
      }

      const { 'mrt-row-actions': _, ...rest } = row as WorkspaceUserDto & {
        'mrt-row-actions': unknown;
      };

      setValidationErrors({});
      onAddMember({
        userId: rest.userId,
        role: rest.role,
      });
      table.setCreatingRow(null);
    },
    onEditingRowSave: async ({ table, row: { original: row } }) => {
      if (Object.keys(validationErrors).some((key) => validationErrors[key])) {
        return;
      }

      const { 'mrt-row-actions': _, ...rest } = row as WorkspaceUserDto & {
        'mrt-row-actions': unknown;
      };

      setValidationErrors({});
      onUpdateMemberRole({
        userId: rest.userId,
        role: rest.role,
      });
      table.setEditingRow(null);
    },
  });

  return <MaterialReactTable table={table} />;
}
