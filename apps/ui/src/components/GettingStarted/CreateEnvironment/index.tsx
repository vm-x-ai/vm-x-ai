'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Alert from '@mui/material/Alert';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import SubmitButton from '@/components/Form/SubmitButton';
import { startTransition, useActionState, useRef } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { submitForm } from './actions';
import { schema } from './schema';
import type { FormSchema } from './schema';
import { useSearchParams } from 'next/navigation';

export default function CreateEnvironmentStep() {
  const searchParams = useSearchParams();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useActionState(submitForm, {
    workspaceId: searchParams.get('workspaceId') || '',
    message: '',
    success: undefined,
  });

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<FormSchema>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: 'dev',
    },
  });

  return (
    <Grid container spacing={3}>
      <Grid size={6}>
        {state?.success === false && (
          <Grid size={12}>
            <Alert severity="error">{state.message}</Alert>
          </Grid>
        )}
        <Grid size={12}>
          <form
            ref={formRef}
            action={() => {
              handleSubmit((values) => {
                startTransition(() => formAction(values));
              })({
                target: formRef.current,
              } as unknown as React.FormEvent<HTMLFormElement>);
            }}
            noValidate
            style={{ width: '100%', marginTop: 1 }}
          >
            <Controller
              name="name"
              control={control}
              render={({ field }) => (
                <TextField
                  {...field}
                  variant="outlined"
                  margin="normal"
                  fullWidth
                  label="Environment Name"
                  placeholder='e.g. "Development" or "Production"'
                  error={!!errors.name?.message}
                  helperText={errors.name?.message}
                />
              )}
            />
            <SubmitButton
              label="Create Environment"
              submittingLabel="Creating Environment..."
            />
          </form>
        </Grid>
      </Grid>
    </Grid>
  );
}
