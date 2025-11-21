'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Alert from '@mui/material/Alert';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid2';
import Typography from '@mui/material/Typography';
import CapacityTable from '@vm-x-ai/console-ui/components/Capacity/CapacityTable';
import SubmitButton from '@vm-x-ai/console-ui/components/Form/SubmitButton';
import { DEFAULT_CAPACITY } from '@vm-x-ai/console-ui/consts/capacity';
import type { AIConnection } from '@vm-x-ai/shared-ai-connection/dto';
import type { Capacity } from '@vm-x-ai/shared-capacity/dto/capacity';
import { MaterialReactTable, useMaterialReactTable, type MRT_ColumnDef } from 'material-react-table';
import { useEffect, useMemo, useRef } from 'react';
import { useFormState } from 'react-dom';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'react-toastify';
import { schema } from './schema';
import type { FormSchema, FormAction } from './schema';

export type AIConnectionCapacityEditFormProps = {
  data: AIConnection;
  workspaceId: string;
  environmentId: string;
  submitAction: (prevState: FormAction, data: FormSchema) => Promise<FormAction>;
};

type DiscoveredCapacity = Capacity & { model: string; errorMessage?: string; updatedAt: string };

export default function AIConnectionCapacityEditForm({
  submitAction,
  data,
  workspaceId,
  environmentId,
}: AIConnectionCapacityEditFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useFormState(submitAction, {
    message: '',
    success: undefined,
    pathParams: {
      workspaceId,
      environmentId,
      connectionId: data.connectionId,
    },
  });

  useEffect(() => {
    if (state.success) {
      toast.success(state.message);
    }
  }, [state]);

  const { control, handleSubmit, watch } = useForm<FormSchema>({
    resolver: zodResolver(schema),
    defaultValues: {
      capacity: data.capacity ?? DEFAULT_CAPACITY,
    },
  });

  const discoveredCapacity = useMemo(() => {
    return Object.entries(data.discoveredCapacity?.models ?? {}).reduce((acc, [model, capacity]) => {
      if (capacity.capacity) {
        acc.push(
          ...capacity.capacity.map((c) => ({
            ...c,
            model,
            errorMessage: capacity.errorMessage,
            updatedAt: capacity.updatedAt,
            requests: c.requests > 0 ? c.requests : (null as never),
            tokens: c.tokens > 0 ? c.tokens : (null as never),
          })),
        );
      } else {
        acc.push({
          model,
          period: null as never,
          requests: null as never,
          tokens: null as never,
          enabled: true,
          errorMessage: capacity.errorMessage,
          updatedAt: capacity.updatedAt,
        });
      }

      return acc;
    }, [] as DiscoveredCapacity[]);
  }, [data]);

  const columns = useMemo<MRT_ColumnDef<DiscoveredCapacity>[]>(
    () => [
      {
        accessorKey: 'model',
        header: 'Model',
      },
      {
        accessorKey: 'period',
        header: 'Period',
      },
      {
        accessorKey: 'requests',
        header: 'Requests',
      },
      {
        accessorKey: 'tokens',
        header: 'Tokens',
      },
      {
        accessorKey: 'errorMessage',
        header: 'Error',
      },
      {
        accessorKey: 'updatedAt',
        header: 'Last Updated At',
        Cell: ({ row: { original: row } }) => new Date(row.updatedAt).toLocaleString(),
      },
    ],
    [],
  );

  const table = useMaterialReactTable({
    columns,
    data: discoveredCapacity,
    enablePagination: false,
    enableSorting: false,
    enableFilters: false,
    enableFullScreenToggle: false,
    enableBottomToolbar: false,
    enableColumnActions: false,
    enableEditing: false,
    enableRowActions: false,
    muiTablePaperProps: {
      elevation: 0,
    },
    initialState: {
      density: 'compact',
    },
  });

  return (
    <Grid container spacing={3}>
      {state && state.success === false && (
        <Grid size={12}>
          <Alert severity="error">{state.message}</Alert>
        </Grid>
      )}
      <Grid size={12}>
        <Typography variant="h6">AI Connection Capacity - {data.name}</Typography>
        <Divider />
      </Grid>
      <Grid size={12}>
        <form
          action={async () => {
            await handleSubmit(async (values) => {
              await formAction(values);
            })({
              target: formRef.current,
            } as unknown as React.FormEvent<HTMLFormElement>);
          }}
          noValidate
        >
          <Grid size={12} marginTop="1rem">
            <Controller
              name="capacity"
              control={control}
              render={({ field }) => <CapacityTable data={watch('capacity')} onChange={field.onChange} />}
            />
          </Grid>
          <Grid size={12} marginTop="1rem">
            <SubmitButton label="Save" submittingLabel="Saving..." />
          </Grid>
        </form>
      </Grid>
      <Grid size={12}>
        <Typography variant="h6">Discovered Capacity</Typography>
        <Divider />
        <Typography variant="caption">This is the capacity that has been discovered from the AI provider.</Typography>
      </Grid>
      <Grid size={12}>
        <MaterialReactTable table={table} />
      </Grid>
    </Grid>
  );
}
