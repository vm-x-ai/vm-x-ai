'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Alert from '@mui/material/Alert';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import SubmitButton from '@/components/Form/SubmitButton';
import { useRouter } from 'next/navigation';
import { startTransition, useActionState, useEffect, useRef } from 'react';
import { Controller, FormProvider, useForm } from 'react-hook-form';
import { toast } from 'react-toastify';
import { schema } from './schema';
import type { FormSchema, FormAction } from './schema';
  import { EnvironmentEntity } from '@/clients/api';

export type EnvironmentEditFormProps = {
  environment: EnvironmentEntity;
  submitAction: (
    prevState: FormAction,
    data: FormSchema
  ) => Promise<FormAction>;
};

export default function EnvironmentEditForm({
  submitAction,
  environment,
}: EnvironmentEditFormProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useActionState(submitAction, {
    message: '',
    data: undefined,
    success: undefined,
  });

  useEffect(() => {
    if (state.success && state.response) {
      toast.success(state.message);
      router.push(`/workspaces`);
    }
  }, [router, state]);

  const form = useForm<FormSchema>({
    resolver: zodResolver(schema),
    defaultValues: {
      workspaceId: environment.workspaceId,
      environmentId: environment.environmentId,
      name: environment.name,
      description: environment.description ?? '',
    },
  });

  return (
    <>
      <Grid container spacing={3}>
        {state && state.success === false && (
          <Grid size={12}>
            <Alert severity="error">{state.message}</Alert>
          </Grid>
        )}
        <Grid size={12}>
          <FormProvider {...form}>
            <form
              action={() => {
                form.handleSubmit((values) => {
                  startTransition(() => formAction(values));
                })({
                  target: formRef.current,
                } as unknown as React.FormEvent<HTMLFormElement>);
              }}
              noValidate
            >
              <Grid size={12}>
                <Typography variant="h6">Edit Environment</Typography>
                <Divider />
              </Grid>
              <Grid container size={12}>
                <Grid size={6}>
                  <Controller
                    name="name"
                    control={form.control}
                    render={({ field }) => (
                      <TextField
                        {...field}
                        variant="outlined"
                        margin="normal"
                        fullWidth
                        label="Environment Name"
                        style={{ marginBottom: '12px' }}
                        error={!!form.formState.errors.name?.message}
                        helperText={form.formState.errors.name?.message}
                      />
                    )}
                  />
                </Grid>
              </Grid>
              <Grid container size={12}>
                <Grid size={6}>
                  <Controller
                    name="description"
                    control={form.control}
                    render={({ field }) => (
                      <TextField
                        {...field}
                        variant="outlined"
                        margin="normal"
                        multiline
                        rows={4}
                        fullWidth
                        label="Description"
                        style={{ marginBottom: '12px' }}
                        error={!!form.formState.errors.description?.message}
                        helperText={
                          form.formState.errors.description?.message ||
                          schema.shape.description.description
                        }
                      />
                    )}
                  />
                </Grid>
              </Grid>
              <Grid size={12} marginTop="1rem">
                <SubmitButton label="Save" submittingLabel="Saving..." />
              </Grid>
            </form>
          </FormProvider>
        </Grid>
      </Grid>
    </>
  );
}
