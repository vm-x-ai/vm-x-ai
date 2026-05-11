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
import Editor from '@/components/Editor';
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
import ModelTuningFields from '../../Common/ModelTuningFields';
import { schema } from './schema';
import type { FormSchema, FormAction } from './schema';
import {
  AiConnectionEntity,
  AiProviderDto,
  AiResourceEntity,
  AiResourceModelConfigEntity,
} from '@/clients/api';
import { useAppStore } from '@/store/provider';

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
      resourceId: data.resourceId,
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

  const setAiResourceChanges = useAppStore(
    (state) => state.setAiResourceChanges
  );

  const {
    control,
    handleSubmit,
    formState: { errors, isDirty },
    watch,
  } = useForm<FormSchema>({
    resolver: zodResolver(schema as never),
    defaultValues: {
      name: data.name ?? '',
      description: data.description ?? '',
      model: data.model,
      defaultArgsJson: data.defaultArgs
        ? JSON.stringify(data.defaultArgs, null, 2)
        : '',
    },
  });

  const formData = watch();

  useEffect(() => {
    setAiResourceChanges(data.resourceId, {
      model: formData.model as AiResourceModelConfigEntity,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.resourceId, formData]);

  const actionMenuItems: ActionMenuItem[] = [
    {
      label: 'Delete AI resource',
      onClick: handleOpenDeleteDialog,
      color: 'error',
    },
  ];

  return (
    <>
      <Box sx={{ width: '100%' }}>
        <Grid container spacing={3}>
          {state && state.success === false && (
            <Grid size={12}>
              <Alert severity="error">{state.message}</Alert>
            </Grid>
          )}
          <Grid size={12}>
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
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
              {/*
                Two-column section layout (8 fields + 4 explanation),
                mirroring the Fallback edit form so the right rail
                consistently carries the contextual help across the
                AI Resource subpages.
              */}
              <Grid container size={12} spacing={3} sx={{ mt: 0 }}>
                <Grid size={8}>
                  <Controller
                    name="name"
                    control={control}
                    render={({ field }) => (
                      <TextField
                        {...field}
                        variant="outlined"
                        size="small"
                        fullWidth
                        label="Resource Name"
                        error={!!errors.name?.message}
                        helperText={errors.name?.message}
                      />
                    )}
                  />
                </Grid>
                <Grid size={4}>
                  <Box sx={{ paddingX: '1rem' }}>
                    <Typography variant="caption" color="text.secondary">
                      Human-readable name for this AI Resource. Used as the
                      routing slug callers reference from the SDK.
                    </Typography>
                  </Box>
                </Grid>
              </Grid>

              <Grid container size={12} spacing={3} sx={{ mt: 2 }}>
                <Grid size={8}>
                  <Controller
                    name="description"
                    control={control}
                    render={({ field }) => (
                      <TextField
                        {...field}
                        variant="outlined"
                        size="small"
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
                <Grid size={4}>
                  <Box sx={{ paddingX: '1rem' }}>
                    <Typography variant="caption" color="text.secondary">
                      {schema.shape.description.description}
                    </Typography>
                  </Box>
                </Grid>
              </Grid>

              <Grid size={12} sx={{ mt: 3 }}>
                <Typography variant="subtitle2">Primary Model</Typography>
                <Divider />
              </Grid>
              <Grid container size={12} spacing={3} sx={{ mt: 2.5 }}>
                <Grid size={8}>
                  <Controller
                    name="model"
                    control={control}
                    render={({ field }) => (
                      <>
                        <ConnectionModelSelector
                          {...field}
                          providersMap={providersMap}
                          onChange={(_, value) =>
                            field.onChange(
                              // Preserve `maxRetries` / `timeoutMs`
                              // when the user only changed connection
                              // / model — without this merge the
                              // selector wipes them on every edit.
                              value
                                ? {
                                    ...(field.value ?? {}),
                                    ...value,
                                  }
                                : null
                            )
                          }
                          workspaceId={workspaceId}
                          environmentId={environmentId}
                          connections={connections}
                          refreshConnectionAction={refreshConnectionAction}
                          renderConnectionInputTextFieldProps={{
                            label: 'Primary Model - Connection',
                            error: !!errors.model?.message,
                            helperText: errors.model?.message,
                          }}
                          renderModelInputTextFieldProps={{
                            label: 'Primary Model - Model ID',
                            error: !!errors.model?.message,
                            helperText: errors.model?.message,
                          }}
                        />
                        <ModelTuningFields
                          value={field.value}
                          onChange={(next) => field.onChange(next)}
                        />
                      </>
                    )}
                  />
                </Grid>
                <Grid size={4}>
                  <Box sx={{ paddingX: '1rem' }}>
                    <Typography variant="caption" color="text.secondary">
                      {schema.shape.model.description} <br />
                      <br />
                      Per-model <code>maxRetries</code> and{' '}
                      <code>timeoutMs</code> fine-tune the chattier paths
                      independently from any caller-supplied{' '}
                      <code>vmx.timeoutMs</code>.
                    </Typography>
                  </Box>
                </Grid>
              </Grid>

              <Grid size={12} sx={{ mt: 3 }}>
                <Typography variant="subtitle2">
                  Default Request Arguments
                </Typography>
                <Divider />
              </Grid>
              <Grid container size={12} spacing={3} sx={{ mt: 2.5 }}>
                <Grid size={8}>
                  <Controller
                    name="defaultArgsJson"
                    control={control}
                    render={({ field }) => (
                      <Box
                        sx={{
                          height: 180,
                          border: '1px solid',
                          borderColor: errors.defaultArgsJson?.message
                            ? 'error.main'
                            : 'divider',
                          borderRadius: 1,
                          overflow: 'hidden',
                        }}
                      >
                        <Editor
                          language="json"
                          value={field.value ?? ''}
                          onChange={(value) => field.onChange(value)}
                          options={{
                            minimap: { enabled: false },
                            lineNumbers: 'off',
                            scrollBeyondLastLine: false,
                            fontSize: 13,
                          }}
                        />
                      </Box>
                    )}
                  />
                  {errors.defaultArgsJson?.message && (
                    <Typography variant="caption" color="error">
                      {errors.defaultArgsJson.message}
                    </Typography>
                  )}
                </Grid>
                <Grid size={4}>
                  <Box sx={{ paddingX: '1rem' }}>
                    <Typography variant="caption" color="text.secondary">
                      JSON object merged into every chat-completions / responses
                      request that targets this resource. Caller-supplied fields
                      win — these only fill in keys the caller didn&apos;t set.
                      Example:{' '}
                      <code>
                        {`{"reasoning_effort":"high","temperature":0}`}
                      </code>
                      .
                    </Typography>
                  </Box>
                </Grid>
              </Grid>

              <Grid
                size={12}
                sx={{
                  marginTop: '1rem',
                }}
              >
                <Box
                  sx={{
                    display: 'flex',
                    justifyContent: 'flex-end',
                  }}
                >
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
