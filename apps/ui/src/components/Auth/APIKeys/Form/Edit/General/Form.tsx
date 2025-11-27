'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Alert from '@mui/material/Alert';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import SubmitButton from '@/components/Form/SubmitButton';
import { startTransition, useActionState, useEffect, useRef } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'react-toastify';
import LabelsSelector from '../../Common/LabelsSelector';
import ResourceSelector from '../../Common/ResourceSelector';
import { schema } from './schema';
import type { FormSchema, FormAction } from './schema';
import { ApiKeyEntity, AiResourceEntity } from '@/clients/api';

export type APIKeyGeneralEditFormProps = {
  data: ApiKeyEntity;
  existingLabels: string[];
  resources: AiResourceEntity[];
  workspaceId: string;
  environmentId: string;
  submitAction: (
    prevState: FormAction,
    data: FormSchema
  ) => Promise<FormAction>;
};

export default function APIKeyGeneralEditForm({
  submitAction,
  data,
  resources,
  existingLabels,
  workspaceId,
  environmentId,
}: APIKeyGeneralEditFormProps) {
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

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<FormSchema>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: data.name,
      description: data.description,
      enabled: data.enabled,
      resources: data.resources,
      labels: data.labels,
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
          <Grid size={12}>
            <Typography variant="h6">Edit Role</Typography>
            <Divider />
          </Grid>
          <Grid container size={12}>
            <Grid size={6}>
              <Controller
                name="name"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    variant="outlined"
                    margin="normal"
                    fullWidth
                    label="Role Name"
                    style={{ marginBottom: '12px' }}
                    error={!!errors.name?.message}
                    helperText={errors.name?.message}
                  />
                )}
              />
            </Grid>
          </Grid>
          <Grid container size={12}>
            <Grid size={6}>
              <Controller
                name="description"
                control={control}
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
                    error={!!errors.description?.message}
                    helperText={
                      errors.description?.message ||
                      schema.shape.description.description
                    }
                  />
                )}
              />
            </Grid>
          </Grid>
          <Grid size={12}>
            <Typography variant="subtitle2">Resources</Typography>
            <Divider />
            <Typography variant="caption">
              Select the resources that this role will have access to.
            </Typography>
          </Grid>
          <Grid container size={12} marginTop="1rem">
            <Grid size={6}>
              <Controller
                name="resources"
                control={control}
                render={({ field }) => (
                  <ResourceSelector {...field} resources={resources} />
                )}
              />
            </Grid>
          </Grid>
          <Grid size={12} marginTop="1rem">
            <Typography variant="subtitle2">Groups</Typography>
            <Divider />
          </Grid>
          <Grid container size={12} marginTop="1rem">
            <Grid size={6}>
              <Controller
                name="labels"
                control={control}
                render={({ field }) => (
                  <LabelsSelector
                    {...field}
                    existingLabels={existingLabels}
                    value={field.value ?? []}
                  />
                )}
              />
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
