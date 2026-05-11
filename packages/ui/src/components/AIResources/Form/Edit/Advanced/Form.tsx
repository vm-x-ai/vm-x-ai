'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import Typography from '@mui/material/Typography';
import Editor from '@/components/Editor';
import SubmitButton from '@/components/Form/SubmitButton';
import {
  startTransition,
  useActionState,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'react-toastify';
import { schema } from './schema';
import type { FormSchema, FormAction } from './schema';
import { AiResourceEntity } from '@/clients/api';

export type AIResourceAdvancedEditFormProps = {
  data: AiResourceEntity;
  workspaceId: string;
  environmentId: string;
  submitAction: (
    prevState: FormAction,
    data: FormSchema
  ) => Promise<FormAction>;
};

/**
 * Free-form JSON editor for the entire AI Resource. Serves three
 * cases the per-section forms can't reach:
 *
 *   1. Migrating bulk config between workspaces — copy the JSON,
 *      tweak IDs, paste.
 *   2. Setting fields the per-section forms intentionally hide
 *      (custom routing trees, raw default-args), without round-
 *      tripping through curl.
 *   3. Inspecting *exactly* what the API has stored, including
 *      computed/server-side fields that the form layer normally
 *      strips before display.
 *
 * The form keeps the JSON as a string so Monaco can flag syntax
 * errors inline. The server action runs the real `zUpdateAiResourceDto`
 * parse before forwarding.
 */
export default function AIResourceAdvancedEditForm({
  submitAction,
  data,
  workspaceId,
  environmentId,
}: AIResourceAdvancedEditFormProps) {
  const formRef = useRef<HTMLFormElement>(null);

  // Strip server-managed fields the user can't change so they don't
  // pollute the editor and mislead. These keys would be ignored by
  // the API anyway (UpdateAiResourceDto = PartialType(CreateDto)).
  const initialJson = useMemo(() => {
    const {
      resourceId: _resourceId,
      workspaceId: _w,
      environmentId: _e,
      createdAt: _c,
      updatedAt: _u,
      createdBy: _cb,
      createdByUser: _cbu,
      updatedBy: _ub,
      updatedByUser: _ubu,
      ...editable
    } = data as AiResourceEntity & Record<string, unknown>;
    return JSON.stringify(editable, null, 2);
  }, [data]);

  const [state, formAction] = useActionState<FormAction, FormSchema>(
    submitAction,
    {
      message: '',
      success: undefined,
      pathParams: {
        workspaceId,
        environmentId,
        resourceId: data.resourceId,
      },
    }
  );

  useEffect(() => {
    if (state.success) toast.success(state.message);
    else if (state.success === false && state.message)
      toast.error(state.message);
  }, [state]);

  const {
    control,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<FormSchema>({
    resolver: zodResolver(schema as never),
    defaultValues: { resourceJson: initialJson },
  });

  return (
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
            <Typography variant="h6">Advanced (JSON)</Typography>
          </Box>
          <Divider />
          <Typography
            variant="caption"
            sx={{ color: 'text.secondary', mt: 1, display: 'block' }}
          >
            Edit the entire AI Resource as a JSON object. Validated against the
            generated <code>UpdateAiResourceDto</code> on submit. Use this for
            bulk migration, custom routing trees, or anything the per-section
            forms don&apos;t expose. Server-managed fields (IDs, audit
            timestamps) are stripped on load and ignored on save.
          </Typography>
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
            <Controller
              name="resourceJson"
              control={control}
              render={({ field }) => (
                <Box
                  sx={{
                    height: 520,
                    border: '1px solid',
                    borderColor: errors.resourceJson?.message
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
                      lineNumbers: 'on',
                      scrollBeyondLastLine: false,
                      fontSize: 13,
                      tabSize: 2,
                    }}
                  />
                </Box>
              )}
            />
            {errors.resourceJson?.message && (
              <Typography variant="caption" color="error">
                {errors.resourceJson.message}
              </Typography>
            )}
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'flex-end',
                mt: 2,
              }}
            >
              <SubmitButton
                label="Save"
                submittingLabel="Saving..."
                isDirty={isDirty}
              />
            </Box>
          </form>
        </Grid>
      </Grid>
    </Box>
  );
}
