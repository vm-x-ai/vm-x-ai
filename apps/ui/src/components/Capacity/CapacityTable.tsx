import {
  CapacityDimension,
  CapacityEntity,
  CapacityPeriod,
} from '@/clients/api';
import DeleteIcon from '@mui/icons-material/Delete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Switch from '@mui/material/Switch';
import Tooltip from '@mui/material/Tooltip';
import {
  MaterialReactTable,
  type MRT_ColumnDef,
  useMaterialReactTable,
} from 'material-react-table';
import { useMemo, useState } from 'react';

type CapacityTableRow = CapacityEntity;

const dimentionOptions = [
  {
    value: CapacityDimension.SOURCE_IP,
    label: 'Source IP',
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
};

export default function CapacityTable({ data, onChange }: CapacityTableProps) {
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
            onChange(data);
          },
        }),
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
    [data, onChange, validationErrors]
  );

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
    muiTablePaperProps: {
      elevation: 0,
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
        if (!row[key]) {
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
