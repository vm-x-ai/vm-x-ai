'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Alert from '@mui/material/Alert';
import Autocomplete from '@mui/material/Autocomplete';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import Link from '@mui/material/Link';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemAvatar from '@mui/material/ListItemAvatar';
import ListItemText from '@mui/material/ListItemText';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import APIKeySelector from '@/components/AIResources/Form/Common/APIKeySelector';
import SubmitButton from '@/components/Form/SubmitButton';
import Markdown from '@/components/Markdown';
import { AWS_REGIONS, AWS_REGIONS_MAP } from '@/consts/aws';
import ejs from 'ejs';
import type { JSONSchema7 } from 'json-schema';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import {
  startTransition,
  useActionState,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import React from 'react';
import type { Control } from 'react-hook-form';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'react-toastify';
import ProviderFieldset from '../Common/ProviderFieldset';
import type { ProviderFieldsetFormSchema } from '../Common/schema';
import BatchCreateResultDialog from './BatchCreateResultDialog';
import { quickSchema, advancedSchema } from './schema';
import type {
  FormAction,
  FormSchema,
  QuickFormSchema,
  AdvancedFormSchema,
  FormType,
} from './schema';
import { AiProviderDto, ApiKeyEntity, EnvironmentEntity } from '@/clients/api';

export type CreateAIConnectionFormProps = {
  workspaceId: string;
  environment: EnvironmentEntity;
  baseUrl: string;
  apiKeys: ApiKeyEntity[];
  providersMap: Record<string, AiProviderDto>;
  submitAction: (
    prevState: FormAction,
    data: FormSchema
  ) => Promise<FormAction>;
  refreshApiKeyAction?: () => Promise<ApiKeyEntity[]>;
};

export default function CreateAIConnectionForm({
  submitAction,
  apiKeys,
  baseUrl,
  workspaceId,
  environment,
  providersMap,
  refreshApiKeyAction,
}: CreateAIConnectionFormProps) {
  const router = useRouter();

  const [formType, setFormType] = useState<FormType>('quick');
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useActionState(submitAction, {
    message: '',
    data: undefined,
    success: undefined,
  });

  useEffect(() => {
    if (state.success && state.response) {
      toast.success(state.message);
    }
  }, [state.message, state.response, state.success]);

  const handleFormTypeChange = (
    event: React.MouseEvent<HTMLElement>,
    newFormType: FormType
  ) => {
    if (!newFormType) {
      return;
    }

    setFormType(newFormType);
  };

  const providers = useMemo(
    () =>
      Object.values(providersMap)
        .filter((item) => item.id !== 'dummy')
        .sort((a, b) => a.id.localeCompare(b.id)),
    [providersMap]
  );

  const quickForm = useForm<QuickFormSchema>({
    resolver: zodResolver(quickSchema as never),
    defaultValues: {
      formType: 'quick',
      workspaceId,
      environmentId: environment.environmentId,
      name: '',
      providers: providers.map((provider) => ({
        provider: provider.id,
        allowedModels: [],
        config: {},
      })),
      assignApiKeys: apiKeys.length ? [apiKeys[0].apiKeyId] : [],
    },
  });

  const advancedForm = useForm<AdvancedFormSchema>({
    resolver: zodResolver(advancedSchema as never),
    defaultValues: {
      formType: 'advanced',
      workspaceId,
      environmentId: environment.environmentId,
      name: '',
      description: '',
      provider: 'openai',
      providersMap,
      allowedModels: [],
      config: {},
      assignApiKeys: apiKeys.length ? [apiKeys[0].apiKeyId] : [],
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
            action={async () => {
              const form = formType === 'quick' ? quickForm : advancedForm;
              form.handleSubmit((values) => {
                startTransition(() => formAction(values));
              })({
                target: formRef.current,
              } as unknown as React.FormEvent<HTMLFormElement>);
            }}
            noValidate
          >
            <ToggleButtonGroup
              color="primary"
              value={formType}
              exclusive
              onChange={handleFormTypeChange}
              aria-label="Form Type"
            >
              <ToggleButton value="quick">Quick Add</ToggleButton>
              <ToggleButton value="advanced">Advanced Add</ToggleButton>
            </ToggleButtonGroup>

            {formType === 'quick' && (
              <>
                <Grid size={12} marginTop="1rem">
                  <Typography variant="h6">Batch add AI connections</Typography>
                  <Divider />
                  <Typography variant="caption">
                    Quick start using multiple AI providers in a few clicks.
                  </Typography>
                </Grid>
                <Grid size={12} marginTop="1rem">
                  <Typography variant="subtitle2">Providers</Typography>
                  <Divider />
                  <Typography variant="caption">
                    Leave empty the providers you don&apos;t want to use, you
                    can always add them later.
                  </Typography>
                </Grid>
                <Grid container size={12} marginTop="1rem">
                  <Grid container size={12} spacing={3} marginLeft="1rem">
                    <Grid size={3} marginTop="1rem">
                      <Typography variant="subtitle2">Provider</Typography>
                      <Divider />
                    </Grid>
                    <Grid size={9} marginTop="1rem">
                      <Typography variant="subtitle2">Config</Typography>
                      <Divider />
                    </Grid>
                  </Grid>
                  <List sx={{ width: '100%', bgcolor: 'background.paper' }}>
                    {providers.map((provider, index) => (
                      <React.Fragment key={provider.id}>
                        <ListItem alignItems="flex-start">
                          <Grid size={12} container spacing={3}>
                            <Grid size={3}>
                              <Box display="flex">
                                <ListItemAvatar>
                                  <Avatar
                                    alt={provider.name}
                                    sx={{ bgcolor: 'transparent' }}
                                  >
                                    <Image
                                      alt={provider.name}
                                      src={provider.config.logo.url}
                                      height={50}
                                      width={55}
                                    />
                                  </Avatar>
                                </ListItemAvatar>
                                <ListItemText
                                  primary={provider.name}
                                  secondary={
                                    <React.Fragment>
                                      {provider.description}
                                    </React.Fragment>
                                  }
                                />
                              </Box>
                            </Grid>
                            <Grid size={9}>
                              <Box
                                display="flex"
                                gap={1}
                                flexDirection="column"
                              >
                                <Box display="flex" width="100%" gap={1}>
                                  {Object.entries(
                                    provider.config.connection.form
                                      .properties as Record<string, JSONSchema7>
                                  ).map(([prop, def]) => {
                                    const errors =
                                      quickForm.formState.errors.providers?.[
                                        index
                                      ]?.config;

                                    if (def.type === 'object') {
                                      // NOTE: Not supported inline nested objects yet
                                      return (
                                        <React.Fragment
                                          key={`${index}-${prop}`}
                                        />
                                      );
                                    }

                                    return (
                                      <Controller
                                        key={`${index}-${prop}`}
                                        name={`providers.${index}.config.${prop}`}
                                        control={quickForm.control}
                                        render={({ field }) => {
                                          if (
                                            def.type === 'string' &&
                                            def.format === 'aws-region'
                                          ) {
                                            return (
                                              <Autocomplete
                                                {...field}
                                                disablePortal
                                                options={AWS_REGIONS}
                                                value={
                                                  field.value
                                                    ? {
                                                        value: field.value,
                                                        label:
                                                          AWS_REGIONS_MAP[
                                                            field.value
                                                          ],
                                                      }
                                                    : null
                                                }
                                                onChange={(_, newValue) => {
                                                  field.onChange(
                                                    newValue?.value
                                                  );
                                                }}
                                                fullWidth
                                                isOptionEqualToValue={(
                                                  option,
                                                  value
                                                ) =>
                                                  option.value === value.value
                                                }
                                                getOptionLabel={(option) =>
                                                  `${option.label} - (${option.value})`
                                                }
                                                renderInput={(params) => (
                                                  <TextField
                                                    {...params}
                                                    label={def.title}
                                                    size="small"
                                                    error={
                                                      !!errors?.[prop]?.message
                                                    }
                                                    helperText={
                                                      errors?.[prop]
                                                        ?.message as string
                                                    }
                                                  />
                                                )}
                                              />
                                            );
                                          }

                                          return (
                                            <Box
                                              key={`${index}-${prop}`}
                                              display="flex"
                                              flexDirection="column"
                                              gap={1}
                                              width="100%"
                                              padding={0}
                                            >
                                              <TextField
                                                {...field}
                                                variant="outlined"
                                                fullWidth
                                                size="small"
                                                label={def.title}
                                                placeholder={
                                                  (
                                                    def as Record<
                                                      string,
                                                      string
                                                    >
                                                  ).placeholder ?? ''
                                                }
                                                error={
                                                  !!errors?.[prop]?.message
                                                }
                                              />
                                              <Box
                                                padding={0}
                                                sx={{
                                                  fontSize: '0.75rem',
                                                  color: 'text.secondary',
                                                }}
                                              >
                                                <Markdown>
                                                  {def.description ||
                                                    (errors?.[prop]
                                                      ?.message as string)}
                                                </Markdown>
                                              </Box>
                                            </Box>
                                          );
                                        }}
                                      />
                                    );
                                  })}
                                </Box>
                                {provider.config.connection.uiComponents?.filter(
                                  (item) => item.type === 'link-button'
                                ).length && (
                                  <Box display="flex" gap={1}>
                                    {provider.config.connection.uiComponents
                                      ?.filter(
                                        (item) => item.type === 'link-button'
                                      )
                                      .map((element, componentIndex) => (
                                        <Button
                                          key={`${index}-${componentIndex}`}
                                          sx={{
                                            ...element.sx,
                                          }}
                                          LinkComponent={Link}
                                          href={ejs.render(element.url, {
                                            environment,
                                            formData: quickForm.watch(),
                                          })}
                                          target={element.target ?? '_blank'}
                                        >
                                          {element.content}
                                        </Button>
                                      ))}
                                  </Box>
                                )}
                              </Box>
                            </Grid>
                          </Grid>
                        </ListItem>
                        <Divider variant="inset" component="li" />
                      </React.Fragment>
                    ))}
                  </List>
                </Grid>
                <Grid size={12} marginTop="1rem">
                  <Typography variant="subtitle2">Prefix</Typography>
                  <Divider />
                  <Typography variant="caption">
                    Prefix all connections with a name, e.g. myprefix-openai,
                    myprefix-groq
                  </Typography>
                </Grid>
                <Grid container size={12}>
                  <Grid size={7}>
                    <Controller
                      name="name"
                      control={quickForm.control}
                      render={({ field }) => (
                        <TextField
                          {...field}
                          variant="outlined"
                          margin="normal"
                          fullWidth
                          label="Prefix Name (optional)"
                          style={{ marginBottom: '12px' }}
                          error={!!quickForm.formState.errors.name?.message}
                          helperText={
                            quickForm.formState.errors.name?.message ||
                            'Leave empty for no prefix, if provided all connections will be prefixed with this value, e.g. myprefix-openai, myprefix-groq'
                          }
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
                  <Typography variant="caption">
                    Once the connection is created an AI resource is
                    automatically created, select the roles you want to assign
                    to the default resource.
                  </Typography>
                </Grid>
                <Grid container size={12} marginTop="1rem">
                  <Grid size={7}>
                    <Controller
                      name="assignApiKeys"
                      control={quickForm.control}
                      render={({ field }) => (
                        <APIKeySelector
                          {...field}
                          multiple
                          options={apiKeys}
                          workspaceId={workspaceId}
                          environmentId={environment.environmentId}
                          onChange={(_, newValue) => {
                            field.onChange(newValue ?? []);
                          }}
                          refreshAction={refreshApiKeyAction}
                        />
                      )}
                    />
                  </Grid>
                </Grid>
              </>
            )}
            {formType === 'advanced' && (
              <Grid container size={6}>
                <Grid size={12} marginTop="1rem">
                  <Typography variant="h6">Create New AI Connection</Typography>
                  <Divider />
                </Grid>
                <Grid container size={12}>
                  <Grid size={12}>
                    <Controller
                      name="name"
                      control={advancedForm.control}
                      render={({ field }) => (
                        <TextField
                          {...field}
                          variant="outlined"
                          margin="normal"
                          fullWidth
                          label="Connection Name"
                          style={{ marginBottom: '12px' }}
                          error={!!advancedForm.formState.errors.name?.message}
                          helperText={
                            advancedForm.formState.errors.name?.message
                          }
                        />
                      )}
                    />
                  </Grid>
                </Grid>
                <Grid container size={12}>
                  <Grid size={12}>
                    <Controller
                      name="description"
                      control={advancedForm.control}
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
                          error={
                            !!advancedForm.formState.errors.description?.message
                          }
                          helperText={
                            advancedForm.formState.errors.description?.message
                          }
                        />
                      )}
                    />
                  </Grid>
                </Grid>
                <Grid size={12}>
                  <Typography variant="subtitle2">Provider</Typography>
                  <Divider />
                </Grid>
                <Grid container size={12} marginTop="1rem">
                  <ProviderFieldset
                    control={
                      advancedForm.control as unknown as Control<ProviderFieldsetFormSchema>
                    }
                    environment={environment}
                    errors={advancedForm.formState.errors}
                    provider={advancedForm.watch('provider')}
                    providersMap={providersMap}
                    formData={advancedForm.watch()}
                  />
                </Grid>
                <Grid size={12} marginTop="1rem">
                  <Typography variant="subtitle2">
                    Assign Roles (Optional)
                  </Typography>
                  <Divider />
                  <Typography variant="caption">
                    Once the connection is created an AI resource is
                    automatically created, select the roles you want to assign
                    to the default resource.
                  </Typography>
                </Grid>
                <Grid container size={12} marginTop="1rem">
                  <Grid size={12}>
                    <Controller
                      name="assignApiKeys"
                      control={advancedForm.control}
                      render={({ field }) => (
                        <APIKeySelector
                          {...field}
                          multiple
                          options={apiKeys}
                          workspaceId={workspaceId}
                          environmentId={environment.environmentId}
                          onChange={(_, newValue) => {
                            field.onChange(newValue ?? []);
                          }}
                          refreshAction={refreshApiKeyAction}
                        />
                      )}
                    />
                  </Grid>
                </Grid>
              </Grid>
            )}
            {state && state.success === false && (
              <Grid size={12} marginTop="1rem">
                <Alert severity="error">{state.message}</Alert>
              </Grid>
            )}
            <Grid size={12} marginTop="1rem">
              <SubmitButton label="Save" submittingLabel="Saving..." />
            </Grid>
          </form>
        </Grid>
      </Grid>
      {state.response && (
        <BatchCreateResultDialog
          workspaceId={workspaceId}
          environmentId={environment.environmentId}
          baseUrl={baseUrl}
          providersMap={providersMap}
          data={{
            connections: state.response?.connections ?? [],
            resources: state.response?.resources ?? [],
          }}
          onClose={() => {
            router.push(
              `/workspaces/${workspaceId}/${environment.environmentId}/ai-connections/overview`
            );
          }}
        />
      )}
    </>
  );
}
