'use client';

import { Delete as DeleteIcon, Edit as EditIcon } from '@mui/icons-material';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import { useTheme } from '@mui/material/styles';
import Tooltip from '@mui/material/Tooltip';
import type { MRT_VisibilityState } from 'material-react-table';
import {
  MaterialReactTable,
  type MRT_ColumnDef,
  useMaterialReactTable,
} from 'material-react-table';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import ConfirmDeleteResourceDialog from './ConfirmDeleteDialog';
import { AiProviderDto, AiResourceEntity } from '@/clients/api';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';

export type AIResourceTableProps = {
  workspaceId?: string;
  environmentId?: string;
  data?: AiResourceEntity[];
  loading?: boolean;
  providersMap: Record<string, AiProviderDto>;
};

export default function AIResourceTable({
  loading = false,
  data,
  workspaceId,
  environmentId,
  providersMap,
}: AIResourceTableProps) {
  const router = useRouter();
  const [confirmDeleteItem, setConfirmDeleteItem] = useState<
    AiResourceEntity | undefined
  >();
  const [columnVisibility, setColumnVisibility] = useState<MRT_VisibilityState>(
    {
      'mrt-row-expand': false,
      description: false,
      updatedAt: false,
    }
  );

  const columns = useMemo<MRT_ColumnDef<AiResourceEntity>[]>(
    () => [
      {
        accessorKey: 'resource',
        header: 'Resource Name',
        Cell: ({ row }) => {
          const theme = useTheme();
          return (
            <Typography
              variant="inherit"
              sx={{ color: theme.palette.primary.main, fontWeight: 'bold' }}
            >
              {row.original.name}
            </Typography>
          );
        },
        minSize: 80,
        maxSize: 80,
      },
      {
        accessorKey: 'description',
        header: 'Description',
      },
      {
        accessorKey: 'model.model',
        header: 'Primary Model',
        Cell: ({ row: { original: row } }) => (
          <Box display="flex" alignItems="center" gap={1}>
            <Image
              alt={providersMap[row.model.provider]?.name || 'ai-provider'}
              src={providersMap[row.model.provider]?.config.logo.url}
              height={20}
              width={20}
            />
            <Typography variant="inherit" component="span">
              {row.model.model}
            </Typography>
          </Box>
        ),
      },
      {
        accessorKey: 'fallbackModels',
        header: 'Fallback Model(s)',
        Cell: ({ row: { original: row } }) => (
          <Typography variant="inherit" component="span">
            <ul>
              {row.fallbackModels?.map((model, index) => (
                <li key={index}>
                  <Box display="flex" alignItems="center" gap={1}>
                    <Image
                      alt={providersMap[model.provider]?.name || 'ai-provider'}
                      src={providersMap[model.provider].config.logo.url}
                      height={20}
                      width={20}
                    />
                    <small>{model.model}</small>
                  </Box>
                </li>
              ))}
            </ul>
          </Typography>
        ),
      },
      {
        accessorKey: 'secondaryModels',
        header: 'Multi-Answer',
        Cell: ({ row: { original: row } }) => (
          <Typography variant="inherit" component="span">
            <ul>
              {row.secondaryModels?.map((model, index) => (
                <li key={index}>
                  <Box display="flex" alignItems="center" gap={1}>
                    <Image
                      alt={providersMap[model.provider]?.name || 'ai-provider'}
                      src={providersMap[model.provider].config.logo.url}
                      height={20}
                      width={20}
                    />
                    <small>{model.model}</small>
                  </Box>
                </li>
              ))}
            </ul>
          </Typography>
        ),
      },
      {
        accessorKey: 'updatedAt',
        header: 'Last Modified',
        size: 250,
        Cell: ({ row: { original: row } }) => (
          <Typography variant="inherit">
            {new Date(row.updatedAt).toLocaleString()}
          </Typography>
        ),
      },
    ],
    [providersMap]
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
    enableColumnActions: false,
    enableSorting: false,
    muiTablePaperProps: {
      elevation: 0,
    },
    muiTableBodyRowProps: ({ row }) => ({
      onClick: () => {
        router.push(
          `/workspaces/${workspaceId}/${environmentId}/ai-resources/edit/${row.original.resourceId}/general`
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
      <Box sx={{ display: 'flex', gap: '.5rem' }}>
        <Tooltip title="Edit">
          <IconButton
            LinkComponent={Link}
            href={`/workspaces/${workspaceId}/${environmentId}/ai-resources/edit/${row.original.resourceId}`}
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
    state: {
      isLoading: loading,
      columnVisibility,
    },
    onColumnVisibilityChange: setColumnVisibility,
    renderTopToolbarCustomActions: () => (
      <Button
        variant="outlined"
        LinkComponent={Link}
        href={`/workspaces/${workspaceId}/${environmentId}/ai-resources/new`}
      >
        Create new AI Resource
      </Button>
    ),
  });

  return (
    <>
      <MaterialReactTable table={table} />
      {workspaceId && environmentId && confirmDeleteItem && (
        <ConfirmDeleteResourceDialog
          resource={confirmDeleteItem}
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
