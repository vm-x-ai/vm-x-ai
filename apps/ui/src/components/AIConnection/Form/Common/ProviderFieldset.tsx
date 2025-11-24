'use client';

import Editor from '@monaco-editor/react';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import InputAdornment from '@mui/material/InputAdornment';
import Link from '@mui/material/Link';
import type { SxProps } from '@mui/material/styles';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Markdown from '@/components/Markdown';
import { AWS_REGIONS, AWS_REGIONS_MAP } from '@/consts/aws';
import ejs from 'ejs';
import type { JSONSchema7 } from 'json-schema';
import Image from 'next/image';
import { useMemo } from 'react';
import type { Control, FieldErrors } from 'react-hook-form';
import { Controller } from 'react-hook-form';
import type { ProviderFieldsetFormSchema } from './schema';
import { AiProviderDto, EnvironmentEntity } from '@/clients/api';

type ProviderFieldsetFormProps = {
  control: Control<ProviderFieldsetFormSchema>;
  errors: FieldErrors<Record<string, unknown>> | undefined;
  properties: Record<string, JSONSchema7>;
  baseKey?: string;
};

function ProviderFieldsetForm({
  control,
  errors,
  properties,
  baseKey = '',
}: ProviderFieldsetFormProps) {
  return (
    <>
      {Object.entries(properties)
        .map<[string, JSONSchema7]>(([key, def], index) => [
          key,
          {
            ...def,
            order: (def as Record<string, string>).order ?? index + 1,
          },
        ])
        .sort(
          (a, b) =>
            (a[1] as Record<string, number>).order -
            (b[1] as Record<string, number>).order
        )
        .map(([key, def], index) => (
          <Grid
            size={12}
            marginTop={index === 0 ? '1rem' : 'none'}
            spacing={3}
            key={key}
          >
            <Controller
              name={`config.${baseKey}${key}`}
              control={control}
              render={({ field }) => {
                if (def.default && !field.value) {
                  field.onChange(def.default);
                }

                if (def.type === 'boolean') {
                  return (
                    <Checkbox
                      {...field}
                      checked={field.value}
                      onChange={(e) => field.onChange(e.target.checked)}
                      color="primary"
                      inputProps={{ 'aria-label': def.title }}
                    />
                  );
                } else if (
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
                              label: AWS_REGIONS_MAP[field.value],
                            }
                          : null
                      }
                      onChange={(_, newValue) => {
                        field.onChange(newValue?.value);
                      }}
                      isOptionEqualToValue={(option, value) =>
                        option.value === value.value
                      }
                      getOptionLabel={(option) =>
                        `${option.label} - (${option.value})`
                      }
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          label={def.title}
                          error={!!errors?.[key]?.message}
                          helperText={errors?.[key]?.message as string}
                        />
                      )}
                    />
                  );
                } else if (def.type === 'object') {
                  return (
                    <>
                      <Grid size={12}>
                        <Typography variant="subtitle2">{def.title}</Typography>
                        <Divider />
                      </Grid>
                      <Grid size={12} marginBottom="1rem">
                        <ProviderFieldsetForm
                          control={control}
                          errors={errors?.[key]}
                          properties={
                            def.properties as Record<string, JSONSchema7>
                          }
                          baseKey={`${baseKey}${key}.`}
                        />
                      </Grid>
                    </>
                  );
                } else if (def.type === 'string' && def.enum) {
                  return (
                    <Autocomplete
                      {...field}
                      disablePortal
                      options={def.enum}
                      value={field.value ?? ''}
                      onChange={(_, newValue) => {
                        field.onChange(newValue);
                      }}
                      isOptionEqualToValue={(option, value) => option === value}
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          label={def.title}
                          error={!!errors?.[key]?.message}
                          helperText={errors?.[key]?.message as string}
                        />
                      )}
                    />
                  );
                }

                return (
                  <Box
                    display="flex"
                    flexDirection="column"
                    gap={1}
                    width="100%"
                    padding={0}
                  >
                    <TextField
                      {...field}
                      variant="outlined"
                      margin="normal"
                      fullWidth
                      label={def.title}
                      placeholder={
                        (def as Record<string, string>).placeholder ?? ''
                      }
                      error={!!errors?.[key]?.message}
                    />
                    <Box
                      padding={0}
                      sx={{
                        fontSize: '0.75rem',
                        color: 'text.secondary',
                      }}
                    >
                      <Markdown>
                        {def.description || (errors?.[key]?.message as string)}
                      </Markdown>
                    </Box>
                  </Box>
                );
              }}
            />
          </Grid>
        ))}
    </>
  );
}

export type ProviderFieldsetProps = {
  provider: string;
  providersMap: Record<string, AiProviderDto>;
  control: Control<ProviderFieldsetFormSchema>;
  errors: FieldErrors<ProviderFieldsetFormSchema>;
  environment: EnvironmentEntity;
  formData: Record<string, unknown>;
};

export default function ProviderFieldset({
  provider,
  providersMap,
  control,
  errors,
  environment,
  formData,
}: ProviderFieldsetProps) {
  const ejsVars = useMemo(
    () => ({ environment, formData }),
    [environment, formData]
  );

  return (
    <>
      <Grid size={12} container spacing={3}>
        <Grid size={12}>
          <Controller
            name="provider"
            control={control}
            render={({ field }) => (
              <Autocomplete
                {...field}
                disablePortal
                options={Object.values(providersMap)}
                value={field.value ? providersMap[field.value] : null}
                renderOption={(props, option) => {
                  return (
                    <li {...props}>
                      <Box display="flex" gap={1}>
                        <Image
                          alt={option.name}
                          src={option.config.logo.url}
                          height={20}
                          width={25}
                        />
                        <Typography>{option.name}</Typography>
                      </Box>
                    </li>
                  );
                }}
                onChange={(_, newValue) => {
                  field.onChange(newValue?.id);
                }}
                isOptionEqualToValue={(option, value) => option.id === value.id}
                getOptionLabel={(option) => option.name}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="AI Provider"
                    error={!!errors.provider?.message}
                    helperText={errors.provider?.message}
                    InputProps={{
                      ...(params.InputProps ?? {}),
                      ...(field.value
                        ? {
                            startAdornment: (
                              <InputAdornment position="start">
                                <Image
                                  alt={providersMap[field.value].name}
                                  src={
                                    providersMap[field.value].config.logo.url
                                  }
                                  height={20}
                                  width={25}
                                  style={{
                                    marginLeft: '.2rem',
                                    marginTop: '.2rem',
                                  }}
                                />
                              </InputAdornment>
                            ),
                          }
                        : {}),
                    }}
                  />
                )}
              />
            )}
          />
        </Grid>
      </Grid>
      <Grid container size={12}>
        {providersMap[provider] && (
          <>
            <Grid size={12} marginTop="1rem">
              <Typography variant="subtitle2">
                {providersMap[provider].config.connection.form.title as string}
              </Typography>
              <Divider />
            </Grid>

            <ProviderFieldsetForm
              control={control}
              errors={errors.config}
              properties={
                providersMap[provider].config.connection.form
                  .properties as Record<string, JSONSchema7>
              }
            />

            <Grid size={12}>
              {providersMap[provider].config.connection.uiComponents?.map(
                (element, index) => {
                  if (element.type === 'accordion') {
                    return (
                      <Accordion key={index}>
                        <AccordionSummary
                          expandIcon={<ExpandMoreIcon />}
                          aria-controls="panel1-content"
                          id="panel1-header"
                        >
                          {element.title}
                        </AccordionSummary>
                        <AccordionDetails>
                          <Grid container size={12} spacing={3}>
                            <Grid size={12}>
                              <Box
                                display="flex"
                                gap={1}
                                flexDirection="column"
                              >
                                {element.elements.map((element, index) => {
                                  if (element.type === 'typography') {
                                    return (
                                      <Typography
                                        key={index}
                                        sx={element.sx ?? {}}
                                        variant={element.variant}
                                      >
                                        {element.content}
                                      </Typography>
                                    );
                                  } else if (element.type === 'editor') {
                                    return (
                                      <Editor
                                        key={index}
                                        height={element.height}
                                        options={{
                                          readOnly: element.readOnly ?? false,
                                          readOnlyMessage: {
                                            value:
                                              element.readOnlyMessage ??
                                              'read-only',
                                          },
                                        }}
                                        defaultLanguage={element.language}
                                        defaultValue={ejs.render(
                                          element.content,
                                          ejsVars
                                        )}
                                      />
                                    );
                                  }

                                  return <></>;
                                })}
                              </Box>
                            </Grid>
                          </Grid>
                        </AccordionDetails>
                      </Accordion>
                    );
                  }

                  if (element.type === 'link-button') {
                    return (
                      <Grid size={12} key={index}>
                        <Button
                          sx={
                            {
                              ...element.sx,
                              marginBottom: element.helperText
                                ? 'none'
                                : element.sx?.marginBottom ?? undefined,
                            } as SxProps
                          }
                          LinkComponent={Link}
                          href={ejs.render(element.url, ejsVars)}
                          target={element.target ?? '_blank'}
                        >
                          {element.content}
                        </Button>
                        {element.helperText && (
                          <Box
                            marginBottom={
                              (element.sx?.marginBottom as string) ?? undefined
                            }
                          >
                            <Typography variant="caption" color="textSecondary">
                              <Markdown>{element.helperText}</Markdown>
                            </Typography>
                          </Box>
                        )}
                      </Grid>
                    );
                  }

                  return <></>;
                }
              )}
            </Grid>
          </>
        )}
      </Grid>
    </>
  );
}
