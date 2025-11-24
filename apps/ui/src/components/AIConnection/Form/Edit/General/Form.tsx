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
import ConfirmDeleteAIConnectionDialog from '@/components/AIConnection/ConfirmDeleteDialog';
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
import { schema } from './schema';
import type { FormAction, FormSchema } from './schema';
import { AiConnectionEntity } from '@/clients/api';

export type AIConnectionGeneralEditFormProps = {
  workspaceId: string;
  environmentId: string;
  data: AiConnectionEntity;
  submitAction: (
    prevState: FormAction,
    data: FormSchema
  ) => Promise<FormAction>;
};

export default function AIConnectionGeneralEditForm({
  submitAction,
  data,
  workspaceId,
  environmentId,
}: AIConnectionGeneralEditFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useActionState(submitAction, {
    message: '',
    success: undefined,
    pathParams: {
      workspaceId,
      environmentId,
      connectionId: data.connectionId,
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
      name: data.name,
      description: data.description ?? '',
    },
  });

  const actionMenuItems: ActionMenuItem[] = [
    {
      label: 'Delete connection',
      onClick: handleOpenDeleteDialog,
      color: 'error',
    },
  ];

  return (
    <>
      <Grid container spacing={3} justifyContent="center">
        {state && state.success === false && (
          <Grid size={12}>
            <Alert severity="error">{state.message}</Alert>
          </Grid>
        )}
        <Grid size={12}>
          <Box sx={{ width: '50%' }}>
            <Box
              display="flex"
              justifyContent="space-between"
              alignItems="center"
            >
              <Typography variant="h6">Edit AI Connection</Typography>
              <ActionMenu actionMenuItems={actionMenuItems} />
            </Box>
            <Divider />
          </Box>
        </Grid>
        <Grid size={12}>
          <Box sx={{ width: '50%' }}>
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
              <Grid container spacing={3}>
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
                        label="Connection Name"
                        error={!!errors.name?.message}
                        helperText={errors.name?.message}
                      />
                    )}
                  />
                </Grid>
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
                        error={!!errors.description?.message}
                        helperText={errors.description?.message}
                      />
                    )}
                  />
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
              </Grid>
            </form>
          </Box>
        </Grid>
      </Grid>

      {confirmDeleteOpen && (
        <ConfirmDeleteAIConnectionDialog
          workspaceId={workspaceId}
          environmentId={environmentId}
          aiConnection={data}
          onClose={handleCloseDeleteDialog}
        />
      )}
    </>
  );
}
