'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Alert from '@mui/material/Alert';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import SubmitButton from '@/components/Form/SubmitButton';
import { useRouter } from 'next/navigation';
import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'react-toastify';
import LabelsSelector from '../Common/LabelsSelector';
import ResourceSelector from '../Common/ResourceSelector';
import APIKeyDialog from './APIKeyDialog';
import { schema } from './schema';
import type { FormSchema, FormAction } from './schema';
import { AiResourceEntity, CreatedApiKeyDto } from '@/clients/api';

export type CreateAPIKeyFormProps = {
  existingLabels: string[];
  resources: AiResourceEntity[];
  workspaceId: string;
  environmentId: string;
  submitAction: (
    prevState: FormAction,
    data: FormSchema
  ) => Promise<FormAction>;
};

export default function CreateAPIKeyForm({
  submitAction,
  existingLabels,
  resources,
  workspaceId,
  environmentId,
}: CreateAPIKeyFormProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [showApiKey, setShowApiKey] = useState<CreatedApiKeyDto | undefined>();
  const [state, formAction] = useActionState(submitAction, {
    message: '',
    data: undefined,
    success: undefined,
  });

  useEffect(() => {
    if (state.success && state.response) {
      toast.success(state.message);
      setShowApiKey(state.response);
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
      enabled: true,
      labels: [],
      resources: [],
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
              <Typography variant="h6">New Role</Typography>
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
      {showApiKey && (
        <APIKeyDialog
          apiKey={showApiKey}
          onClose={async () => {
            setShowApiKey(undefined);

            router.push(
              `/workspaces/${workspaceId}/${environmentId}/security/auth/role/edit/${state.response?.apiKeyId}/general`
            );
          }}
        />
      )}
    </>
  );
}
