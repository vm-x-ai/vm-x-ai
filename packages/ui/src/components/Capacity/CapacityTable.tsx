import {
  CapacityDimension,
  CapacityEntity,
  CapacityPeriod,
} from '@/clients/api';
import DeleteIcon from '@mui/icons-material/Delete';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import {
  MaterialReactTable,
  type MRT_ColumnDef,
  useMaterialReactTable,
} from 'material-react-table';
import { useMrtTheme } from '@/hooks/use-mrt-theme';
import { useMemo, useState } from 'react';

type CapacityTableRow = CapacityEntity;

const dimentionOptions = [
  {
    value: CapacityDimension.SOURCE_IP,
    label: 'Source IP',
  },
  {
    value: CapacityDimension.METADATA,
    label: 'Metadata',
  },
];

const periodOptions = [
  {
    value: 'minute',
    label: 'Per Minute',
  },
  {
    value: 'hour',
    label: 'Per Hour',
  },
  {
    value: 'day',
    label: 'Per Day',
  },
  {
    value: 'week',
    label: 'Per Week',
  },
  {
    value: 'month',
    label: 'Per Month',
  },
  {
    value: 'lifetime',
    label: 'Lifetime',
  },
];

const validateRequired = (value: string) => !!value.length;

export type CapacityTableProps = {
  data: CapacityTableRow[];
  onChange: (data: CapacityTableRow[]) => void;
  /**
   * Distinct metadata keys observed on recent completion audits — used
   * to populate the Dimension Field autocomplete when the user picks
   * the METADATA dimension. Same source as the audit / usage pages so
   * the suggestion list stays consistent. Defaults to empty (input
   * still accepts free text via `freeSolo`).
   */
  metadataKeys?: string[];
};

export default function CapacityTable({
  data,
  onChange,
  metadataKeys = [],
}: CapacityTableProps) {
  const [validationErrors, setValidationErrors] = useState<
    Record<string, string | undefined>
  >({});

  const columns = useMemo<MRT_ColumnDef<CapacityTableRow>[]>(
    () => [
      {
        accessorKey: 'period',
        header: 'Period',
        editSelectOptions: periodOptions,
        muiEditTextFieldProps: ({ cell, row: { original: row, index } }) => ({
          select: true,
          disabled: index >= 0 && index < 5,
          error: !!validationErrors?.[cell.id],
          helperText: validationErrors?.[cell.id],
          onChange: (e) => {
            const selectedValue = e.target.value;
            setValidationErrors({
              ...validationErrors,
              [cell.id]: undefined,
            });

            row.period = selectedValue as CapacityPeriod;
            onChange(data);
          },
        }),
      },
      {
        accessorKey: 'requests',
        header: 'Requests',
        muiEditTextFieldProps: ({ cell, row: { original: row } }) => ({
          type: 'number',
          required: true,
          error: !!validationErrors?.[cell.id],
          helperText: validationErrors?.[cell.id],
          onBlur: (event) => {
            const validationError = !validateRequired(event.currentTarget.value)
              ? 'Required'
              : undefined;
            setValidationErrors({
              ...validationErrors,
              [cell.id]: validationError,
            });

            row.requests = parseInt(event.currentTarget.value, 10);
            onChange(data);
          },
        }),
      },
      {
        accessorKey: 'tokens',
        header: 'Tokens',
        muiEditTextFieldProps: ({ cell, row: { original: row } }) => ({
          type: 'number',
          required: true,
          error: !!validationErrors?.[cell.id],
          helperText: validationErrors?.[cell.id],
          onBlur: (event) => {
            const validationError = !validateRequired(event.currentTarget.value)
              ? 'Required'
              : undefined;
            setValidationErrors({
              ...validationErrors,
              [cell.id]: validationError,
            });
            row.tokens = parseInt(event.currentTarget.value, 10);
            onChange(data);
          },
        }),
      },
      {
        accessorKey: 'dimension',
        header: 'Dimension',
        editSelectOptions: dimentionOptions,
        muiEditTextFieldProps: ({ cell, row: { original: row, index } }) => ({
          select: true,
          disabled: index >= 0 && index < 5,
          error: !!validationErrors?.[cell.id],
          helperText: validationErrors?.[cell.id],
          onChange: (e) => {
            const selectedValue = e.target.value;
            setValidationErrors({
              ...validationErrors,
              [cell.id]: undefined,
            });

            row.dimension = selectedValue as CapacityDimension;
            // Clearing the field name keeps the row consistent when
            // the user switches from METADATA back to SOURCE_IP / none.
            if (selectedValue !== CapacityDimension.METADATA) {
              row.dimensionField = null;
            }
            onChange(data);
          },
        }),
      },
      {
        accessorKey: 'dimensionField',
        header: 'Dimension Field',
        Cell: ({ row: { original: row } }) =>
          row.dimension === CapacityDimension.METADATA
            ? row.dimensionField ?? ''
            : '',
        // Custom edit renderer so we can drop in MUI's `Autocomplete`
        // (with `freeSolo` so unknown keys can still be typed). The
        // suggestion list is the same `metadataKeys` source the audit
        // and usage pages use — distinct metadata keys observed on
        // recent completion audits. Disabled when dimension isn't
        // METADATA so the value never leaks onto a SOURCE_IP cap.
        Edit: ({ cell, row: { original: row, index } }) => {
          const disabled =
            (index >= 0 && index < 5) ||
            row.dimension !== CapacityDimension.METADATA;
          return (
            <Autocomplete
              freeSolo
              fullWidth
              size="small"
              disabled={disabled}
              options={metadataKeys}
              value={row.dimensionField ?? ''}
              onInputChange={(_, newValue) => {
                const trimmed = newValue.trim();
                row.dimensionField = trimmed || null;
                onChange(data);
                if (row.dimension === CapacityDimension.METADATA && !trimmed) {
                  setValidationErrors((prev) => ({
                    ...prev,
                    [cell.id]: 'Required for Metadata dimension',
                  }));
                } else if (validationErrors?.[cell.id]) {
                  setValidationErrors((prev) => ({
                    ...prev,
                    [cell.id]: undefined,
                  }));
                }
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  // Match the other table cells, which inherit MRT's
                  // default `standard` (underline) variant via
                  // `muiEditTextFieldProps`. Using `outlined` here
                  // would give the Autocomplete a boxed border that
                  // visually doesn't line up with the rest of the row.
                  variant="standard"
                  placeholder="e.g. userId"
                  error={!!validationErrors?.[cell.id]}
                  helperText={
                    validationErrors?.[cell.id] ??
                    (row.dimension === CapacityDimension.METADATA
                      ? 'Metadata key to bucket by'
                      : undefined)
                  }
                />
              )}
            />
          );
        },
      },
      {
        accessorKey: 'enabled',
        header: 'Enabled',
        Cell: ({ row: { original: row } }) => (row.enabled ? 'Yes' : 'No'),
        Edit: ({ row: { original: row } }) => (
          <Switch
            checked={row.enabled ?? false}
            onChange={() => {
              row.enabled = !row.enabled;
              setValidationErrors({
                ...validationErrors,
                enabled: undefined,
              });
              onChange(data);
            }}
          />
        ),
      },
    ],
    [data, onChange, validationErrors, metadataKeys]
  );

  const mrtThemeProps = useMrtTheme();
  const table = useMaterialReactTable({
    columns,
    data,
    enablePagination: false,
    enableSorting: false,
    enableFilters: false,
    enableFullScreenToggle: false,
    enableBottomToolbar: false,
    enableColumnActions: false,
    createDisplayMode: 'row',
    editDisplayMode: 'table',
    enableEditing: true,
    enableRowActions: true,
    ...mrtThemeProps,
    muiTablePaperProps: {
      elevation: 0,
      ...mrtThemeProps.muiTablePaperProps,
    },
    initialState: {
      columnPinning: {
        right: ['mrt-row-actions'],
      },
    },
    positionCreatingRow: 'bottom',
    onCreatingRowCancel: () => setValidationErrors({}),
    renderTopToolbarCustomActions: ({ table }) => (
      <Button
        variant="contained"
        onClick={() => {
          table.setCreatingRow(true);
        }}
      >
        Create Capacity Rule
      </Button>
    ),
    renderRowActions: ({ row: { original: row, index } }) => (
      <Box sx={{ display: 'flex', gap: '1rem' }}>
        <Tooltip
          title={
            index >= 0 && index < 5
              ? 'The first 5 rules are fixed and cannot be deleted'
              : 'Delete'
          }
        >
          <span>
            <IconButton
              color="error"
              disabled={index >= 0 && index < 5}
              onClick={() => {
                onChange([
                  ...data.slice(0, data.indexOf(row)),
                  ...data.slice(data.indexOf(row) + 1),
                ]);
              }}
            >
              <DeleteIcon />
            </IconButton>
          </span>
        </Tooltip>
      </Box>
    ),
    onCreatingRowSave: async ({ table, row: { original: row } }) => {
      delete (row as Record<string, unknown>)['mrt-row-actions'];
      let failedValidation = false;
      const fields = columns.map(
        (column) => column.accessorKey as keyof CapacityEntity
      );
      fields.forEach((key) => {
        // `dimensionField` is only required when the dimension is
        // METADATA — for SOURCE_IP and the un-dimensioned case the
        // column stays empty by design.
        const optional =
          key === 'dimensionField' &&
          row.dimension !== CapacityDimension.METADATA;
        if (!row[key] && !optional) {
          setValidationErrors((prev) => ({
            ...prev,
            [key]: 'Required',
          }));

          failedValidation = true;
        } else {
          setValidationErrors((prev) => ({
            ...prev,
            [key]: undefined,
          }));
        }
      });

      if (failedValidation) {
        return;
      }

      if (Object.keys(validationErrors).some((key) => validationErrors[key])) {
        return;
      }

      setValidationErrors({});
      onChange([...data, row]);
      table.setCreatingRow(null);
    },
  });

  return <MaterialReactTable table={table} />;
}
