'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Alert from '@mui/material/Alert';
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
  AiResourceModelConfigEntity,
} from '@/clients/api';
import MultiConnectionModelSelector from '../../Common/MultiConnectionModelSelector';
import { useAppStore } from '@/store/provider';

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
      resourceId: data.resourceId,
    },
  });

  useEffect(() => {
    if (state.success) {
      toast.success(state.message);
    }
  }, [state]);

  const setAiResourceChanges = useAppStore(
    (state) => state.setAiResourceChanges
  );

  const { control, handleSubmit, setValue, watch } = useForm<FormSchema>({
    resolver: zodResolver(schema as never),
    defaultValues: {
      fallbackModels: data.fallbackModels ?? [],
      useFallback: data.useFallback ?? false,
    },
  });

  const formData = watch();

  useEffect(() => {
    setAiResourceChanges(data.resourceId, {
      fallbackModels: formData.fallbackModels as AiResourceModelConfigEntity[],
      useFallback: formData.useFallback,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.resourceId, formData]);

  return (
    <Grid container spacing={3}>
      {state && state.success === false && (
        <Grid size={12}>
          <Alert severity="error">{state.message}</Alert>
        </Grid>
      )}
      <Grid size={12}>
        <Typography variant="h6">AI Resource Fallback - {data.name}</Typography>
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
          <Grid
            container
            size={12}
            spacing={2}
            sx={{
              marginTop: '1rem',
            }}
          >
            {/*
              Toggle is short, so 2 columns is plenty; the rest of the
              row goes to the fallback-models table so wide rows
              (Provider / Connection / Model / Actions + edit menu)
              don't need horizontal scrolling. The contextual caption
              moves to its own row below the table — keeping it on the
              right was squeezing the table even when set to 2 columns.
            */}
            <Grid size={2}>
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
            <Grid size={10}>
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
            <Grid size={12}>
              <Typography variant="caption" color="text.secondary">
                Enabling fallback ensures that a second model is called if your
                primary model returns an error.
              </Typography>
            </Grid>
          </Grid>

          <Grid
            size={12}
            sx={{
              marginTop: '1rem',
            }}
          >
            <SubmitButton label="Save" submittingLabel="Saving..." sticky />
          </Grid>
        </form>
      </Grid>
    </Grid>
  );
}
