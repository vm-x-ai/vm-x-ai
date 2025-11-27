'use client';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Image from 'next/image';
import { useMemo, useState } from 'react';
import {
  AiConnectionEntity,
  AiProviderDto,
  AiResourceModelConfigEntity,
} from '@/clients/api';
import {
  MaterialReactTable,
  MRT_ColumnDef,
  useMaterialReactTable,
} from 'material-react-table';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Autocomplete from '@mui/material/Autocomplete';
import Tooltip from '@mui/material/Tooltip';
import IconButton from '@mui/material/IconButton';
import DeleteIcon from '@mui/icons-material/Delete';
import { toast } from 'react-toastify';
import RefreshIcon from '@mui/icons-material/Refresh';

export type MultiConnectionModelSelectorProps = {
  workspaceId?: string;
  environmentId?: string;
  connections: AiConnectionEntity[];
  providersMap: Record<string, AiProviderDto>;
  refreshConnectionAction?: () => Promise<AiConnectionEntity[]>;
  noRecordsToDisplay?: string;
  value?: AiResourceModelConfigEntity[] | null;
  onChange?: (value: AiResourceModelConfigEntity[] | null) => void;
};

const validateRequired = (value: string) => !!value.length;

export default function MultiConnectionModelSelector({
  workspaceId,
  environmentId,
  connections: rawConnections,
  providersMap,
  refreshConnectionAction,
  noRecordsToDisplay = 'No models configured',
  onChange,
  ...props
}: MultiConnectionModelSelectorProps) {
  const [connections, setConnections] =
    useState<AiConnectionEntity[]>(rawConnections);
  const [refreshing, setRefreshing] = useState(false);

  const connectionMap = useMemo(
    () =>
      new Map<string, AiConnectionEntity>(
        connections.map((connection) => [connection.connectionId, connection])
      ),
    [connections]
  );
  const [validationErrors, setValidationErrors] = useState<
    Record<string, string | undefined>
  >({});
  const columns = useMemo<
    MRT_ColumnDef<Partial<AiResourceModelConfigEntity>>[]
  >(
    () => [
      {
        accessorKey: 'provider',
        header: 'Provider',
        size: 50,
        enableEditing: false,
        Cell: ({ row: { original: row } }) =>
          row.provider && (
            <Tooltip title={providersMap[row.provider]?.name}>
              <Image
                alt={providersMap[row.provider]?.name || 'ai-provider'}
                src={providersMap[row.provider]?.config.logo.url}
                height={20}
                width={20}
              />
            </Tooltip>
          ),
      },
      {
        accessorKey: 'connectionId',
        header: 'Connection',
        Cell: ({ row: { original: row } }) => (
          <Box display="flex" alignItems="center" gap={1}>
            {row.provider && (
              <Image
                alt={providersMap[row.provider]?.name || 'ai-provider'}
                src={providersMap[row.provider]?.config.logo.url}
                height={20}
                width={20}
              />
            )}
            <Typography variant="inherit" component="span">
              {row.connectionId
                ? connectionMap.get(row.connectionId)?.name
                : row.connectionId}
            </Typography>
          </Box>
        ),
        Edit({ row: { original: row, index }, column }) {
          return (
            <Autocomplete
              options={connections}
              fullWidth
              value={
                row.connectionId ? connectionMap.get(row.connectionId) : null
              }
              renderOption={(props, option) => {
                const { key, ...optionProps } = props;
                return (
                  <Box
                    key={key}
                    component="li"
                    sx={{ '& > img': { mr: 2, flexShrink: 0 } }}
                    {...optionProps}
                  >
                    <Image
                      alt={providersMap[option.provider].name}
                      src={providersMap[option.provider].config.logo.url}
                      height={20}
                      width={25}
                    />
                    {option?.description || option?.name}
                  </Box>
                );
              }}
              getOptionLabel={(option) =>
                `${providersMap[option.provider].name} - ${option.name}`
              }
              onChange={(_, newValue) => {
                const selectedValue = newValue?.connectionId;
                const validationError = !validateRequired(selectedValue ?? '')
                  ? 'Connection is required'
                  : undefined;
                setValidationErrors({
                  ...validationErrors,
                  [column.id]: validationError,
                });

                row.connectionId = selectedValue;
                if (newValue) {
                  const defaultModel =
                    providersMap[newValue.provider].defaultModel;
                  row.provider = newValue.provider;
                  row.model = defaultModel;

                  if (index !== -1 && props.value) {
                    onChange?.([
                      ...props.value.slice(0, index),
                      {
                        ...props.value[index],
                        provider: newValue.provider,
                        connectionId: newValue.connectionId,
                        model: defaultModel,
                      },
                      ...props.value.slice(index + 1),
                    ]);
                  }
                }
              }}
              renderInput={(params) => (
                <>
                  <Box display="flex" gap="1rem">
                    <TextField
                      {...params}
                      variant="standard"
                      margin="none"
                      size="small"
                      slotProps={{
                        input: {
                          ...(params.InputProps ?? {}),
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
                  </Box>
                </>
              )}
            />
          );
        },
      },
      {
        accessorKey: 'model',
        header: 'Model ID',
        Cell: ({ row: { original: row } }) => (
          <Box display="flex" alignItems="center" gap={1}>
            {row.provider && (
              <Image
                alt={providersMap[row.provider]?.name || 'ai-provider'}
                src={providersMap[row.provider]?.config.logo.url}
                height={20}
                width={20}
              />
            )}
            <Typography variant="inherit" component="span">
              {row.model}
            </Typography>
          </Box>
        ),
        muiEditTextFieldProps: ({ row: { original: row, index }, column }) => ({
          type: 'text',
          required: true,
          error: !!validationErrors?.[column.id],
          helperText: validationErrors?.[column.id],
          value: row.model,
          onChange: (event) => {
            row.model = event.currentTarget.value;
            if (index !== -1 && props.value) {
              onChange?.([
                ...props.value.slice(0, index),
                {
                  ...props.value[index],
                  model: event.currentTarget.value,
                },
                ...props.value.slice(index + 1),
              ]);
            }
          },
          onBlur: (event) => {
            const validationError = !validateRequired(event.currentTarget.value)
              ? 'Model ID is required'
              : undefined;
            const newValidationErrors = {
              ...validationErrors,
              [column.id]: validationError,
            };
            setValidationErrors(newValidationErrors);
            row.model = event.currentTarget.value;
          },
        }),
      },
    ],
    [
      connectionMap,
      connections,
      onChange,
      props.value,
      providersMap,
      validationErrors,
    ]
  );

  const table = useMaterialReactTable({
    columns,
    data: props.value || [],
    enablePagination: false,
    enableSorting: false,
    enableFilters: false,
    enableFullScreenToggle: false,
    enableBottomToolbar: false,
    enableColumnActions: false,
    enableDensityToggle: false,
    createDisplayMode: 'row',
    editDisplayMode: 'table',
    enableEditing: true,
    enableRowActions: true,
    muiTablePaperProps: {
      elevation: 0,
    },
    initialState: {
      columnPinning: {
        right: ['mrt-row-actions'],
      },
    },
    localization: {
      noRecordsToDisplay,
    },
    positionCreatingRow: 'bottom',
    renderTopToolbarCustomActions: ({ table }) => (
      <Box display="flex" gap="1rem">
        <Button
          variant="contained"
          size="small"
          onClick={() => {
            table.setCreatingRow(true);
          }}
        >
          Add Model
        </Button>
        {refreshConnectionAction && (
          <Button
            variant="outlined"
            size="small"
            onClick={async () => {
              setRefreshing(true);
              try {
                const refreshConnections = await refreshConnectionAction();
                if (refreshConnections?.length) {
                  setConnections(refreshConnections);
                }
              } catch (error) {
                toast.error(
                  'Failed to refresh connections: ' +
                    (error instanceof Error ? error.message : 'Unknown error')
                );
              } finally {
                setRefreshing(false);
              }
            }}
            loading={refreshing}
            startIcon={<RefreshIcon fontSize="large" />}
          >
            Refresh Connections
          </Button>
        )}
      </Box>
    ),
    onCreatingRowCancel: () => setValidationErrors({}),
    renderRowActions: ({ row: { original: row, index } }) => (
      <Box sx={{ display: 'flex', gap: '1rem' }}>
        <Tooltip title="Delete">
          <span>
            <IconButton
              color="error"
              onClick={() => {
                onChange?.(
                  props.value
                    ? [
                        ...props.value.slice(0, index),
                        ...props.value.slice(index + 1),
                      ]
                    : null
                );
              }}
            >
              <DeleteIcon />
            </IconButton>
          </span>
        </Tooltip>
      </Box>
    ),
    onCreatingRowSave: async ({ table, row: { original: row } }) => {
      if (Object.keys(validationErrors).some((key) => validationErrors[key])) {
        return;
      }

      const { 'mrt-row-actions': _, ...rest } =
        row as AiResourceModelConfigEntity & { 'mrt-row-actions': unknown };

      setValidationErrors({});
      onChange?.(props.value ? [...props.value, rest] : [rest]);
      table.setCreatingRow(null);
    },
  });

  return <MaterialReactTable table={table} />;
}
