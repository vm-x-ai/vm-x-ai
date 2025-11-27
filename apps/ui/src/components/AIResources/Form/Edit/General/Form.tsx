'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { ActionMenuItem } from '@/components/ActionMenu/ActionMenu';
import ActionMenu from '@/components/ActionMenu/ActionMenu';
import ConfirmDeleteResourceDialog from '@/components/AIResources/ConfirmDeleteDialog';
import SubmitButton from '@/components/Form/SubmitButton';
import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'react-toastify';
import ConnectionModelSelector from '../../Common/ConnectionModelSelector';
import { schema } from './schema';
import type { FormSchema, FormAction } from './schema';
import {
  AiConnectionEntity,
  AiProviderDto,
  AiResourceEntity,
} from '@/clients/api';

export type AIResourceGeneralEditFormProps = {
  data: AiResourceEntity;
  connections: AiConnectionEntity[];
  workspaceId: string;
  environmentId: string;
  providersMap: Record<string, AiProviderDto>;
  submitAction: (
    prevState: FormAction,
    data: FormSchema
  ) => Promise<FormAction>;
  refreshConnectionAction?: () => Promise<AiConnectionEntity[]>;
};

export default function AIResourceGeneralEditForm({
  submitAction,
  data,
  connections,
  workspaceId,
  environmentId,
  providersMap,
  refreshConnectionAction,
}: AIResourceGeneralEditFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useActionState(submitAction, {
    message: '',
    success: undefined,
    pathParams: {
      workspaceId,
      environmentId,
      resourceName: data.resource,
    },
  });
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const handleOpenDeleteDialog = () => setConfirmDeleteOpen(true);
  const handleCloseDeleteDialog = () => setConfirmDeleteOpen(false);

  useEffect(() => {
    if (state.success) {
      toast.success(state.message);
    }
  }, [state]);

  const {
    control,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<FormSchema>({
    resolver: zodResolver(schema),
    defaultValues: {
      resource: data.resource,
      description: data.description ?? '',
      model: data.model,
    },
  });

  const actionMenuItems: ActionMenuItem[] = [
    {
      label: 'Delete AI resource',
      onClick: handleOpenDeleteDialog,
      color: 'error',
    },
  ];

  return (
    <>
      <Box sx={{ width: '50%' }}>
        <Grid container spacing={3}>
          {state && state.success === false && (
            <Grid size={12}>
              <Alert severity="error">{state.message}</Alert>
            </Grid>
          )}
          <Grid size={12}>
            <Box
              display="flex"
              justifyContent="space-between"
              alignItems="center"
            >
              <Typography variant="h6">Edit AI Resource</Typography>
              <ActionMenu actionMenuItems={actionMenuItems} />
            </Box>
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
                    name="resource"
                    control={control}
                    render={({ field }) => (
                      <TextField
                        {...field}
                        variant="outlined"
                        margin="normal"
                        fullWidth
                        label="Resource Name"
                        disabled
                        style={{ marginBottom: '12px' }}
                        error={!!errors.resource?.message}
                        helperText="You cannot change the resource name after creation."
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
                        workspaceId={workspaceId}
                        environmentId={environmentId}
                        connections={connections}
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
                <Box display="flex" justifyContent="flex-end">
                  {' '}
                  <SubmitButton
                    label="Save"
                    submittingLabel="Saving..."
                    isDirty={isDirty}
                  />
                </Box>
              </Grid>
            </form>
          </Grid>
        </Grid>
      </Box>
      {confirmDeleteOpen && (
        <ConfirmDeleteResourceDialog
          workspaceId={workspaceId}
          environmentId={environmentId}
          resource={data}
          onClose={handleCloseDeleteDialog}
        />
      )}
    </>
  );
}
