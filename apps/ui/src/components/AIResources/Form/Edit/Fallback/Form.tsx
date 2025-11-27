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
import { startTransition, useEffect, useRef } from 'react';
import { useFormState } from 'react-dom';
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

export type AIResourceFallbackEditFormProps = {
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

export default function AIResourceFallbackEditForm({
  submitAction,
  data,
  workspaceId,
  environmentId,
  connections,
  providersMap,
  refreshConnectionAction,
}: AIResourceFallbackEditFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useFormState(submitAction, {
    message: '',
    success: undefined,
    pathParams: {
      workspaceId,
      environmentId,
      resourceName: data.resource,
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
    setValue,
  } = useForm<FormSchema>({
    resolver: zodResolver(schema),
    defaultValues: {
      fallbackModels: data.fallbackModels ?? [],
      useFallback: data.useFallback ?? false,
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
          AI Resource Fallback - {data.resource}
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
                  <Controller
                    name="useFallback"
                    control={control}
                    render={({ field }) => (
                      <Switch {...field} checked={field.value} />
                    )}
                  />
                }
                label="Use fallback"
              />
            </Grid>
            <Grid size={5}>
              <Grid size={12}>
                <Controller
                  name="fallbackModels"
                  control={control}
                  render={({ field }) => (
                    <MultiConnectionModelSelector
                      {...field}
                      providersMap={providersMap}
                      onChange={(value) => {
                        field.onChange(value);
                        if (value?.length) {
                          setValue('useFallback', true);
                        }
                      }}
                      connections={connections}
                      workspaceId={workspaceId}
                      environmentId={environmentId}
                      refreshConnectionAction={refreshConnectionAction}
                      noRecordsToDisplay="No fallback models configured"
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
                  Enabling fallback ensures that a second model is called if
                  your primary model returns an error
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
