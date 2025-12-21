'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import DynamicRoutingTree from '@/components/AIResources/Form/Edit/Routing/DynamicRoutingTree';
import SubmitButton from '@/components/Form/SubmitButton';
import { startTransition, useActionState, useEffect, useRef } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'react-toastify';
import ConnectionModelSelector from '../../Common/ConnectionModelSelector';
import { schema } from './schema';
import type { FormSchema, FormAction } from './schema';
import {
  AiConnectionEntity,
  AiProviderDto,
  AiResourceEntity,
  AiResourceModelConfigEntity,
  AiResourceModelRoutingEntity,
  AiRoutingConditionGroup,
} from '@/clients/api';
import { useAppStore } from '@/store/provider';

export type AIResourceRoutingEditFormProps = {
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

export default function AIResourceRoutingEditForm({
  submitAction,
  data,
  workspaceId,
  environmentId,
  connections,
  providersMap,
  refreshConnectionAction,
}: AIResourceRoutingEditFormProps) {
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

  const setAiResourceChanges = useAppStore(
    (state) => state.setAiResourceChanges
  );

  useEffect(() => {
    if (state.success) {
      toast.success(state.message);
    }
  }, [state]);

  const {
    control,
    handleSubmit,
    formState: { errors },
    watch,
  } = useForm<FormSchema>({
    resolver: zodResolver(schema),
    defaultValues: {
      model: data.model,
      routing: data.routing ?? {
        enabled: false,
        conditions: [],
      },
    },
  });

  const formData = watch();

  useEffect(() => {
    setAiResourceChanges(data.resourceId, {
      routing: formData.routing as AiResourceModelRoutingEntity,
      model: formData.model as AiResourceModelConfigEntity,
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
        <Box display="flex" alignItems="center" gap={1}>
          {' '}
          <Typography variant="h6">Dynamic Routing</Typography>
          <Typography variant="body2">
            (for AI Resource: {data.name})
          </Typography>
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
          <Grid container size={12} marginTop="1rem">
            <Grid size={12}>
              <FormControlLabel
                control={
                  <Controller
                    name="routing.enabled"
                    control={control}
                    render={({ field }) => (
                      <Switch {...field} checked={field.value} />
                    )}
                  />
                }
                label="Use dynamic routing"
              />
            </Grid>

            <Grid container spacing={3} size={12} marginTop="1rem">
              {watch('routing.enabled') && (
                <>
                  <Grid size={12}>
                    <Controller
                      name="routing.conditions"
                      control={control}
                      render={({ field }) => (
                        <DynamicRoutingTree
                          data={
                            (field.value ?? []) as AiRoutingConditionGroup[]
                          }
                          environmentId={environmentId}
                          workspaceId={workspaceId}
                          connections={connections}
                          refreshConnectionAction={refreshConnectionAction}
                          providersMap={providersMap}
                          onChange={field.onChange}
                        />
                      )}
                    />
                  </Grid>
                  <Grid size={12}>
                    <Divider />
                  </Grid>
                  <Grid size={7}>
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
                            label: watch('routing.enabled')
                              ? 'Default Model - Model ID'
                              : 'Primary Model - Model ID',
                            error: !!errors.model?.message,
                            helperText:
                              errors.model?.message ||
                              schema.shape.model.description,
                          }}
                        />
                      )}
                    />
                  </Grid>
                </>
              )}
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
