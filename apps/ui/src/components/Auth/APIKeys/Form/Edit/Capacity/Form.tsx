'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Alert from '@mui/material/Alert';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import CapacityTable from '@/components/Capacity/CapacityTable';
import SubmitButton from '@/components/Form/SubmitButton';
import { DEFAULT_CAPACITY } from '@/components/Capacity/consts';
import { startTransition, useActionState, useEffect, useRef } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'react-toastify';
import { schema } from './schema';
import type { FormSchema, FormAction } from './schema';
import { ApiKeyEntity, CapacityEntity } from '@/clients/api';

export type APIKeyCapacityEditFormProps = {
  data: ApiKeyEntity;
  workspaceId: string;
  environmentId: string;
  submitAction: (
    prevState: FormAction,
    data: FormSchema
  ) => Promise<FormAction>;
};

export default function APIKeyCapacityEditForm({
  submitAction,
  data,
  workspaceId,
  environmentId,
}: APIKeyCapacityEditFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useActionState(submitAction, {
    message: '',
    success: undefined,
    pathParams: {
      workspaceId,
      environmentId,
      apiKeyId: data.apiKeyId,
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
      enforceCapacity: data.enforceCapacity ?? false,
      capacity: data.capacity ?? DEFAULT_CAPACITY,
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
        <Typography variant="h6">Role Capacity - {data.name}</Typography>
        <Divider />
        <Typography variant="caption">
          You can specifically enforce a limit for requests / tokens for this
          resource, by default, the used capacity is defined in the AI
          connection.
        </Typography>
      </Grid>
      <Grid size={12}>
        <form
          action={() => {
            handleSubmit((values) => {
              startTransition(() => formAction(values));
            })({
              target: formRef.current,
            } as unknown as React.FormEvent<HTMLFormElement>);
          }}
          noValidate
        >
          <Grid container size={12} marginTop="1rem">
            <Grid size={3}>
              <FormControlLabel
                control={
                  <Controller
                    name="enforceCapacity"
                    control={control}
                    render={({ field }) => (
                      <Switch {...field} checked={field.value} />
                    )}
                  />
                }
                label="Enforce capacity constraints"
              />
            </Grid>
            <Grid size={8}>
              {watch('enforceCapacity') && (
                <Controller
                  name="capacity"
                  control={control}
                  render={({ field }) => (
                    <CapacityTable
                      data={watch('capacity') as CapacityEntity[]}
                      onChange={field.onChange}
                    />
                  )}
                />
              )}
            </Grid>
          </Grid>

          <Grid size={12} marginTop="1rem">
            <SubmitButton label="Save" submittingLabel="Saving..." />
          </Grid>
        </form>
      </Grid>
    </Grid>
  );
}
