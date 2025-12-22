'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import SubmitButton from '@/components/Form/SubmitButton';
import { startTransition, useActionState, useEffect, useRef } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'react-toastify';
import { schema } from './schema';
import type { FormSchema, FormAction } from './schema';
import {
  AiConnectionEntity,
  AiProviderDto,
  AiResourceEntity,
} from '@/clients/api';
import MultiConnectionModelSelector from '../../Common/MultiConnectionModelSelector';

export type AIResourceSecondaryModelsEditFormProps = {
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

export default function AIResourceSecondaryModelsEditForm({
  submitAction,
  data,
  workspaceId,
  environmentId,
  connections,
  refreshConnectionAction,
  providersMap,
}: AIResourceSecondaryModelsEditFormProps) {
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

  useEffect(() => {
    if (state.success) {
      toast.success(state.message);
    }
  }, [state]);

  const { control, handleSubmit, watch } = useForm<FormSchema>({
    resolver: zodResolver(schema),
    defaultValues: {
      secondaryModels: data.secondaryModels ?? [],
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
        <Typography variant="h6">
          AI Resource Multi-Answer - {data.name}
        </Typography>
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
          <Grid container size={12} marginTop="1rem">
            <Grid size={3}>
              <FormControlLabel
                control={
                  <Switch
                    checked={!!watch('secondaryModels')?.length}
                    readOnly
                  />
                }
                label="Use multi response"
              />
            </Grid>
            <Grid size={5}>
              <Grid size={12}>
                <Controller
                  name="secondaryModels"
                  control={control}
                  render={({ field }) => (
                    <MultiConnectionModelSelector
                      {...field}
                      providersMap={providersMap}
                      onChange={(value) => field.onChange(value)}
                      connections={connections}
                      workspaceId={workspaceId}
                      environmentId={environmentId}
                      refreshConnectionAction={refreshConnectionAction}
                      noRecordsToDisplay="No secondary models configured"
                    />
                  )}
                />
              </Grid>
            </Grid>
            <Grid size={3}>
              <Box
                sx={{
                  paddingLeft: '1rem',
                  paddingRight: '1rem',
                }}
              >
                <Typography variant="caption" color="gray">
                  When using multi-response, your model call will be routed to
                  more than 1 model at the same time. Giving you multiple
                  responses to a single API call.
                  <br />
                  <br />
                  You need to explicitly set in the VM-X SDK to receive multiple
                  responses.
                </Typography>
              </Box>
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
