'use client';

import { Delete as DeleteIcon, Edit as EditIcon } from '@mui/icons-material';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
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
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useEffect } from 'react';
import ConfirmDeleteAIConnectionDialog from './ConfirmDeleteDialog';
import { AiConnectionEntity, AiProviderDto } from '@/clients/api';

export type AIConnectionTableProps = {
  workspaceId?: string;
  environmentId?: string;
  data?: AiConnectionEntity[];
  loading?: boolean;
  providersMap: Record<string, AiProviderDto>;
};

export default function AIConnectionTable({
  loading = false,
  data,
  workspaceId,
  environmentId,
  providersMap,
}: AIConnectionTableProps) {
  const theme = useTheme();
  const router = useRouter();
  const [confirmDeleteItem, setConfirmDeleteItem] = useState<
    AiConnectionEntity | undefined
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

  const columns = useMemo<MRT_ColumnDef<AiConnectionEntity>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'AI Connection',
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
        accessorKey: 'provider',
        header: 'AI Provider',
        size: 300,
        Cell: ({ row: { original: row } }) => (
          <Chip
            key={row.provider}
            size="small"
            label={providersMap[row.provider]?.name ?? 'Unkown'}
            icon={
              <Box>
                <Image
                  alt={providersMap[row.provider]?.name}
                  src={providersMap[row.provider]?.config.logo.url}
                  height={20}
                  width={20}
                />
              </Box>
            }
          />
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
    [providersMap, theme.palette.primary.main]
  );

  const table = useMaterialReactTable({
    columns,
    data: data || [],
    displayColumnDefOptions: { 'mrt-row-actions': { size: 120 } },
    enableFullScreenToggle: false,
    enableExpandAll: false,
    enableRowActions: false,
    enableEditing: false,
    enableColumnResizing: false,
    enableSorting: false,
    enableColumnActions: false,
    muiTablePaperProps: {
      elevation: 0,
    },
    muiTableBodyRowProps: ({ row }) => ({
      onClick: () => {
        router.push(
          `/workspaces/${workspaceId}/${environmentId}/ai-connections/edit/${row.original.connectionId}/general`
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
    renderRowActions: ({ row }) => (
      <Box sx={{ display: 'flex', gap: '1rem' }}>
        <Tooltip title="Edit">
          <IconButton
            LinkComponent={Link}
            href={`/workspaces/${workspaceId}/${environmentId}/ai-connections/edit/${row.original.connectionId}`}
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
        href={`/workspaces/${workspaceId}/${environmentId}/ai-connections/new`}
      >
        Add new AI Connection
      </Button>
    ),
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
        <ConfirmDeleteAIConnectionDialog
          aiConnection={confirmDeleteItem}
          workspaceId={workspaceId}
          environmentId={environmentId}
          onClose={() => {
            setConfirmDeleteItem(undefined);
          }}
        />
      )}
    </>
  );
}
