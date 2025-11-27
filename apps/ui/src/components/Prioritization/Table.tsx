'use client';

import { Add as AddIcon, Delete as DeleteIcon } from '@mui/icons-material';
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import type { MRT_Row, MRT_VisibilityState } from 'material-react-table';
import {
  MaterialReactTable,
  type MRT_ColumnDef,
  useMaterialReactTable,
  createRow,
} from 'material-react-table';
import { useCallback, useEffect, useMemo, useState } from 'react';
import ConfirmDeletePoolDefinitionDialog from './ConfirmDeleteDialog';
import { PoolDefinitionEntity, PoolDefinitionEntry } from '@/clients/api';
import {
  getPoolDefinitionOptions,
  updatePoolDefinitionMutation,
} from '@/clients/api/@tanstack/react-query.gen';
import { useMutation, useQuery } from '@tanstack/react-query';

export type PoolDefinitionTableProps = {
  workspaceId?: string;
  environmentId?: string;
  data?: PoolDefinitionEntity;
  resources?: string[];
  loading?: boolean;
};

export default function PoolDefinitionTable({
  loading: initialLoading = false,
  data: initialData,
  resources,
  workspaceId,
  environmentId,
}: PoolDefinitionTableProps) {
  const { data, isLoading, refetch } = useQuery({
    ...getPoolDefinitionOptions({
      path: {
        workspaceId: workspaceId as string,
        environmentId: environmentId as string,
      },
    }),
    initialData: initialData,
    enabled: !!workspaceId && !!environmentId,
  });
  const loading = initialLoading || isLoading;

  const [availableResources, setAvailableResources] = useState<string[]>(
    resources ?? []
  );
  const [confirmDeleteItem, setConfirmDeleteItem] = useState<
    PoolDefinitionEntry | undefined
  >();
  const [validationErrors, setValidationErrors] = useState<
    Record<string, string | undefined>
  >({});
  const [columnVisibility, setColumnVisibility] = useState<MRT_VisibilityState>(
    {
      'mrt-row-expand': false,
    }
  );

  const { mutateAsync: updateDefinition, isPending: updatingDefinition } =
    useMutation({
      ...updatePoolDefinitionMutation(),
    });

  useEffect(() => {
    if (resources) {
      setAvailableResources(
        resources?.filter(
          (resource) =>
            !data?.definition?.some((item) => item.resources.includes(resource))
        ) ?? []
      );
    }
  }, [data?.definition, resources]);

  const getPoolColor = useCallback(
    (index: number) => {
      return index === 0
        ? 'success'
        : index + 1 !== data?.definition?.length
        ? 'info'
        : 'default';
    },
    [data?.definition?.length]
  );

  const getPoolColorVariable = useCallback(
    (index: number) => {
      const color = getPoolColor(index);
      return color === 'default'
        ? `--mui-palette-grey-300`
        : `--mui-palette-${color}-main`;
    },
    [getPoolColor]
  );

  const onCellUpdate = useCallback(
    async (
      row: MRT_Row<PoolDefinitionEntry>,
      changes: Partial<PoolDefinitionEntry>
    ) => {
      if (workspaceId == undefined || environmentId == undefined) {
        return;
      }

      const itemIndex = data?.definition?.findIndex(
        (item) => item.name === row.original.name
      );
      if (itemIndex === undefined || itemIndex === -1) {
        return;
      }

      await updateDefinition({
        path: {
          workspaceId,
          environmentId,
        },
        body: {
          definition: [
            ...(data?.definition?.slice(0, itemIndex) || []),
            {
              ...row.original,
              ...changes,
            },
            ...(data?.definition?.slice(itemIndex + 1) || []),
          ],
        },
      });
      await refetch();
    },
    [data?.definition, environmentId, refetch, updateDefinition, workspaceId]
  );

  const columns = useMemo<MRT_ColumnDef<PoolDefinitionEntry>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Pool Name',
        size: 100,
        muiEditTextFieldProps: ({ row }) => ({
          required: true,
          error: !!validationErrors?.name,
          helperText: validationErrors?.name || 'Enter a name for the pool',
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
            const validationError = !event.target.value
              ? 'Pool name is required'
              : undefined;
            setValidationErrors({
              ...validationErrors,
              name: validationError,
            });
          },
          onBlur: async (event) => {
            if (validationErrors?.name) {
              return;
            }

            await onCellUpdate(row, {
              name: event.target.value,
            });
          },
        }),
      },
      {
        accessorKey: 'minReservation',
        header: 'Min (%)',
        size: 50,
        muiEditTextFieldProps: ({ row }) => ({
          type: 'number',
          required: true,
          error: !!validationErrors?.minReservation,
          helperText: validationErrors?.minReservation,
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
            const validationError = !event.target.value
              ? 'Min reservation is required'
              : undefined;
            setValidationErrors({
              ...validationErrors,
              minReservation: validationError,
            });
          },
          onBlur: async (event: React.FocusEvent<HTMLInputElement>) => {
            if (validationErrors?.minReservation) {
              return;
            }

            await onCellUpdate(row, {
              minReservation: event.currentTarget.valueAsNumber,
            });
          },
        }),
      },
      {
        accessorKey: 'maxReservation',
        header: 'Max (%)',
        size: 50,
        muiEditTextFieldProps: ({ row }) => ({
          type: 'number',
          required: true,
          error: !!validationErrors?.maxReservation,
          helperText: validationErrors?.maxReservation,
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
            const validationError = !event.target.value
              ? 'Max reservation is required'
              : undefined;
            setValidationErrors({
              ...validationErrors,
              maxReservation: validationError,
            });
          },
          onBlur: async (event: React.FocusEvent<HTMLInputElement>) => {
            if (validationErrors?.minReservation) {
              return;
            }

            await onCellUpdate(row, {
              maxReservation: event.currentTarget.valueAsNumber,
            });
          },
        }),
      },
      {
        accessorKey: 'resources',
        header: 'Resources',
        size: 300,
        Cell: ({ row: { original: row, index } }) => (
          <Box
            sx={{
              display: 'flex',
              gap: '.5rem',
            }}
          >
            {row.resources.map((resource) => (
              <Chip
                key={resource}
                label={resource}
                color={getPoolColor(index)}
              />
            ))}
          </Box>
        ),
        Edit: ({ row, table }) => (
          <>
            <Autocomplete
              multiple
              size="small"
              value={row._valuesCache.resources ?? row.original.resources}
              options={availableResources ?? []}
              onChange={async (_, value) => {
                row._valuesCache.resources = value;
                setValidationErrors({
                  ...validationErrors,
                  resources: undefined,
                });

                await onCellUpdate(row, {
                  resources: value,
                });
              }}
              onBlur={() => {
                table.setEditingCell(null);
              }}
              disableCloseOnSelect
              renderTags={(value, getTagProps) =>
                value.map((option, index) => {
                  const { key, ...tagProps } = getTagProps({ index });
                  return (
                    <Chip
                      key={key}
                      color={getPoolColor(row.index)}
                      label={option}
                      {...tagProps}
                    />
                  );
                })
              }
              renderOption={(props, option, { selected }) => {
                const { key, ...optionProps } = props;
                return (
                  <li key={key} {...optionProps}>
                    <Checkbox
                      icon={<CheckBoxOutlineBlankIcon fontSize="small" />}
                      checkedIcon={<CheckBoxIcon fontSize="small" />}
                      style={{ marginRight: 8 }}
                      checked={selected}
                    />
                    {option}
                  </li>
                );
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  variant="standard"
                  placeholder="Select resources"
                />
              )}
            />
          </>
        ),
      },
    ],
    [availableResources, getPoolColor, onCellUpdate, validationErrors]
  );

  const table = useMaterialReactTable({
    columns,
    data: [...(data?.definition || [])],
    enablePagination: false,
    enableSorting: false,
    enableFilters: false,
    enableFullScreenToggle: false,
    enableBottomToolbar: false,
    enableColumnActions: false,
    enableExpandAll: false,
    enableRowActions: true,
    positionActionsColumn: 'last',
    createDisplayMode: 'row',
    editDisplayMode: 'cell',
    enableDensityToggle: false,
    autoResetPageIndex: false,
    enableRowOrdering: true,
    enableEditing: true,
    muiTablePaperProps: {
      elevation: 0,
    },
    muiDetailPanelProps: () => ({
      sx: {
        width: '100%',
        margin: 0,
      },
    }),
    muiTableBodyRowProps: ({ row }) => ({
      sx: {
        'td:first-child': {
          borderLeft: `.4rem solid var(${getPoolColorVariable(row.index)})`,
        },
      },
    }),
    muiRowDragHandleProps: ({ table }) => ({
      onDragEnd: async () => {
        if (workspaceId == undefined || environmentId == undefined) {
          return;
        }

        const { draggingRow, hoveredRow } = table.getState();
        if (hoveredRow && draggingRow) {
          data?.definition?.splice(
            (hoveredRow as MRT_Row<PoolDefinitionEntry>).index,
            0,
            data?.definition?.splice(draggingRow.index, 1)[0]
          );

          await updateDefinition({
            path: {
              workspaceId,
              environmentId,
            },
            body: {
              definition: data?.definition || [],
            },
          });
          await refetch();
        }
      },
    }),
    renderTopToolbarCustomActions: ({ table }) => (
      <Box sx={{ display: 'flex', gap: '1rem', p: '4px' }}>
        <Button
          color="primary"
          variant="outlined"
          startIcon={<AddIcon />}
          onClick={() => {
            table.setCreatingRow(
              createRow<PoolDefinitionEntry>(table, {
                name: '',
                rank: data?.definition?.length || 0,
                maxReservation: 100,
                minReservation: 0,
                resources: [],
              })
            );
            table.setExpanded({
              'mrt-row-create': true,
            });
          }}
        >
          Add Pool
        </Button>
      </Box>
    ),
    renderRowActions: ({ row }) => (
      <Box sx={{ display: 'flex', gap: '1rem' }}>
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
    onCreatingRowSave: async ({ row, values, table }) => {
      if (workspaceId == undefined || environmentId == undefined) {
        return;
      }
      await updateDefinition({
        path: { workspaceId, environmentId },
        body: {
          definition: [
            ...(data?.definition || []),
            {
              name: values.name || row.original.name,
              rank: data?.definition?.length || 0,
              maxReservation: Number(
                values.maxReservation || row.original.maxReservation
              ),
              minReservation: Number(
                values.minReservation || row.original.minReservation
              ),
              resources: values.resources || row.original.resources,
            },
          ],
        },
      });
      await refetch();
      table.setCreatingRow(null);
    },
    state: {
      isSaving: updatingDefinition,
      isLoading: loading,
      columnVisibility,
      density: 'spacious',
    },
    onColumnVisibilityChange: setColumnVisibility,
  });

  return (
    <>
      <MaterialReactTable table={table} />
      {workspaceId && environmentId && confirmDeleteItem && data && (
        <ConfirmDeletePoolDefinitionDialog
          data={data}
          entry={confirmDeleteItem}
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
