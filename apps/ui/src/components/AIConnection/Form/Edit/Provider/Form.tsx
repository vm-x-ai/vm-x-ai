'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid2';
import Typography from '@mui/material/Typography';
import SubmitButton from '@vm-x-ai/console-ui/components/Form/SubmitButton';
import { DIMENSIONS } from '@vm-x-ai/console-ui/consts/layoutConstants';
import type { AIConnection } from '@vm-x-ai/shared-ai-connection/dto';
import type { AIProviderConfig } from '@vm-x-ai/shared-ai-provider/dto';
import type { GetEnvironmentResponse } from '@vm-x-ai/shared-environment/dto';
import { useEffect, useRef } from 'react';
import { useFormState } from 'react-dom';
import type { Control } from 'react-hook-form';
import { useForm } from 'react-hook-form';
import { toast } from 'react-toastify';
import ProviderFieldset from '../../Common/ProviderFieldset';
import type { ProviderFieldsetFormSchema } from '../../Common/schema';
import { schema } from './schema';
import type { FormAction, FormSchema } from './schema';

const formMaxWidth = DIMENSIONS.form.maxWidth;

export type AIConnectionProviderEditFormProps = {
  workspaceId: string;
  environment: GetEnvironmentResponse;
  providersMap: Record<string, AIProviderConfig>;
  data: AIConnection;
  submitAction: (prevState: FormAction, data: FormSchema) => Promise<FormAction>;
};

export default function AIConnectionProviderEditForm({
  submitAction,
  data,
  workspaceId,
  environment,
  providersMap,
}: AIConnectionProviderEditFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useFormState(submitAction, {
    message: '',
    success: undefined,
    pathParams: {
      workspaceId,
      environmentId: environment.environmentId,
      connectionId: data.connectionId,
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
    formState: { errors, isDirty },
    watch,
  } = useForm<FormSchema>({
    resolver: zodResolver(schema),
    defaultValues: {
      environmentManagedBy: environment.physicalEnvironment ? 'vmx' : 'user',
      provider: data?.provider ?? 'openai',
      allowedModels: data?.allowedModels ?? [],
      config: data?.config ?? {},
      providersMap,
    },
  });

  return (
    <Grid container spacing={3} justifyContent="center">
      {state && state.success === false && (
        <Grid size={12}>
          <Alert severity="error">{state.message}</Alert>
        </Grid>
      )}
      <Grid size={12}>
        <Box sx={{ maxWidth: formMaxWidth, width: '100%' }}>
          <Typography variant="h6">AI Connection Provider - {data.name}</Typography>
          <Divider />
        </Box>
      </Grid>
      <Grid size={12}>
        <Box sx={{ maxWidth: formMaxWidth, width: '100%' }}>
          <form
            action={async () => {
              await handleSubmit(async (values) => {
                await formAction(values);
              })({
                target: formRef.current,
              } as unknown as React.FormEvent<HTMLFormElement>);
            }}
            noValidate
          >
            <ProviderFieldset
              control={control as unknown as Control<ProviderFieldsetFormSchema>}
              environment={environment}
              errors={errors}
              provider={watch('provider')}
              providersMap={providersMap}
              formData={watch()}
            />
            <Grid size={12} marginTop="1rem">
              <Box display="flex" justifyContent="flex-end">
                <SubmitButton label="Save" submittingLabel="Saving..." isDirty={isDirty} />
              </Box>
            </Grid>
          </form>
        </Box>
      </Grid>
    </Grid>
  );
}
