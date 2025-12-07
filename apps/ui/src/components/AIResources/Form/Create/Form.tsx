'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import SubmitButton from '@/components/Form/SubmitButton';
import { useRouter } from 'next/navigation';
import { startTransition, useActionState, useEffect, useRef } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'react-toastify';
import APIKeySelector from '../Common/APIKeySelector';
import ConnectionModelSelector from '../Common/ConnectionModelSelector';
import { schema } from './schema';
import type { FormSchema, FormAction } from './schema';
import {
  AiConnectionEntity,
  AiProviderDto,
  ApiKeyEntity,
  AiResourceEntity,
} from '@/clients/api';

export type CreateAIResourceFormProps = {
  data?: AiResourceEntity;
  connections: AiConnectionEntity[];
  apiKeys: ApiKeyEntity[];
  workspaceId: string;
  environmentId: string;
  providersMap: Record<string, AiProviderDto>;
  submitAction: (
    prevState: FormAction,
    data: FormSchema
  ) => Promise<FormAction>;
  refreshConnectionAction?: () => Promise<AiConnectionEntity[]>;
  refreshApiKeyAction?: () => Promise<ApiKeyEntity[]>;
};

export default function CreateAIResourceForm({
  submitAction,
  data,
  connections,
  apiKeys,
  refreshConnectionAction,
  refreshApiKeyAction,
  workspaceId,
  environmentId,
  providersMap,
}: CreateAIResourceFormProps) {
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

      router.push(
        `/workspaces/${workspaceId}/${environmentId}/ai-resources/edit/${state.response?.resourceId}/general`
      );
    }
  }, [environmentId, router, state, workspaceId]);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<FormSchema>({
    resolver: zodResolver(schema),
    defaultValues: {
      workspaceId,
      environmentId,
      name: '',
      description: '',
      assignApiKeys: [apiKeys[0].apiKeyId],
    },
  });

  return (
    <Box sx={{ width: '50%' }}>
      <Grid container spacing={3}>
        {state && state.success === false && (
          <Grid size={12}>
            <Alert severity="error">{state.message}</Alert>
          </Grid>
        )}
        <Grid size={12}>
          <Typography variant="h6">New AI Resource</Typography>
          <Divider />
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
            <Grid container size={12}>
              <Grid size={12}>
                <Controller
                  name="name"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      variant="outlined"
                      margin="normal"
                      fullWidth
                      label="Resource Name"
                      disabled={!!data}
                      style={{ marginBottom: '12px' }}
                      error={!!errors.name?.message}
                      helperText={errors.name?.message}
                    />
                  )}
                />
              </Grid>
            </Grid>
            <Grid container size={12}>
              <Grid size={12}>
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
              <Typography variant="subtitle2">Primary Model</Typography>
              <Divider />
            </Grid>
            <Grid container size={12} marginTop="1rem">
              <Grid size={12}>
                <Controller
                  name="model"
                  control={control}
                  render={({ field }) => (
                    <ConnectionModelSelector
                      {...field}
                      providersMap={providersMap}
                      onChange={(_, value) => field.onChange(value)}
                      connections={connections}
                      workspaceId={workspaceId}
                      environmentId={environmentId}
                      refreshConnectionAction={refreshConnectionAction}
                      renderConnectionInputTextFieldProps={{
                        label: 'Primary Model - Connection',
                        error: !!errors.model?.message,
                        helperText:
                          errors.model?.message ||
                          schema.shape.model.description,
                      }}
                      renderModelInputTextFieldProps={{
                        label: 'Primary Model - Model ID',
                        error: !!errors.model?.message,
                        helperText:
                          errors.model?.message ||
                          schema.shape.model.description,
                      }}
                    />
                  )}
                />
              </Grid>
            </Grid>
            <Grid size={12} marginTop="1rem">
              <Typography variant="subtitle2">
                Assign Roles (Optional)
              </Typography>
              <Divider />
            </Grid>
            <Grid container size={12} marginTop="1rem">
              <Grid size={12}>
                <Controller
                  name="assignApiKeys"
                  control={control}
                  render={({ field }) => (
                    <APIKeySelector
                      {...field}
                      multiple
                      options={apiKeys}
                      workspaceId={workspaceId}
                      environmentId={environmentId}
                      onChange={(_, newValue) => {
                        field.onChange(newValue ?? []);
                      }}
                      refreshAction={refreshApiKeyAction}
                    />
                  )}
                />
              </Grid>
            </Grid>
            <Grid size={12} marginTop="1rem">
              <Box display="flex" justifyContent="flex-end">
                {' '}
                <SubmitButton label="Save" submittingLabel="Saving..." />
              </Box>
            </Grid>
          </form>
        </Grid>
      </Grid>
    </Box>
  );
}
