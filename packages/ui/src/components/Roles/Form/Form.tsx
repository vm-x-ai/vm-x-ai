'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Alert from '@mui/material/Alert';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import SubmitButton from '@/components/Form/SubmitButton';
import { useRouter } from 'next/navigation';
import { startTransition, useActionState, useEffect, useRef } from 'react';
import { Controller, FormProvider, useForm } from 'react-hook-form';
import { toast } from 'react-toastify';
import { schema } from './schema';
import type { FormSchema, FormAction } from './schema';
import { RoleDto, RolePolicyEffect } from '@/clients/api';
import MembersTable from '../MembersTable';
import PolicyField from '../Common/PolicyField';

export type RoleFormProps = {
  role?: RoleDto;
  submitAction: (
    prevState: FormAction,
    data: FormSchema
  ) => Promise<FormAction>;
};

export default function RoleForm({ submitAction, role }: RoleFormProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useActionState(submitAction, {
    message: '',
    data: undefined,
    success: undefined,
  });

  useEffect(() => {
    if (state.success && state.response) {
      toast.success(state.message);
      router.push(`/settings/roles`);
    }
  }, [router, state]);

  const form = useForm<FormSchema>({
    resolver: zodResolver(schema as never),
    defaultValues: {
      roleId: role?.roleId ?? undefined,
      name: role?.name ?? '',
      description: role?.description ?? '',
      policy: role?.policy ?? {
        $schema: 'https://vm-x.ai/schema/role-policy.json',
        statements: [
          {
            effect: RolePolicyEffect.ALLOW,
            actions: ['*'],
            resources: ['*'],
          },
        ],
      },
      members: role?.members ?? [],
    },
  });

  console.log('errors', form.formState.errors);

  return (
    <>
      <Grid container spacing={3}>
        {state && state.success === false && (
          <Grid size={12}>
            <Alert severity="error">{state.message}</Alert>
          </Grid>
        )}
        <Grid size={12}>
          <FormProvider {...form}>
            <form
              action={() => {
                form.handleSubmit((values) => {
                  startTransition(() => formAction(values));
                })({
                  target: formRef.current,
                } as unknown as React.FormEvent<HTMLFormElement>);
              }}
              noValidate
            >
              <Grid size={12}>
                <Typography variant="h6">
                  {role ? 'Edit Role' : 'New Role'}
                </Typography>
                <Divider />
              </Grid>
              <Grid container size={12}>
                <Grid size={6}>
                  <Controller
                    name="name"
                    control={form.control}
                    render={({ field }) => (
                      <TextField
                        {...field}
                        variant="outlined"
                        margin="normal"
                        fullWidth
                        label="Role Name"
                        style={{ marginBottom: '12px' }}
                        error={!!form.formState.errors.name?.message}
                        helperText={form.formState.errors.name?.message}
                      />
                    )}
                  />
                </Grid>
              </Grid>
              <Grid container size={12}>
                <Grid size={6}>
                  <Controller
                    name="description"
                    control={form.control}
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
                        error={!!form.formState.errors.description?.message}
                        helperText={
                          form.formState.errors.description?.message ||
                          schema.shape.description.description
                        }
                      />
                    )}
                  />
                </Grid>
              </Grid>
              <PolicyField />
              <Grid size={12}>
                <Controller
                  name="members"
                  control={form.control}
                  render={({ field }) => (
                    <MembersTable
                      value={field.value}
                      onAddMember={(member) => {
                        field.onChange([...(field.value ?? []), member]);
                        form.setValue('newMembers', [
                          ...(form.getValues('newMembers') ?? []),
                          member,
                        ]);
                        const removedMembers =
                          form.getValues('removedMembers') ?? [];
                        if (
                          removedMembers.some((m) => m.userId === member.userId)
                        ) {
                          form.setValue(
                            'removedMembers',
                            removedMembers.filter(
                              (m) => m.userId !== member.userId
                            )
                          );
                        }
                      }}
                      onRemoveMember={(member) => {
                        field.onChange(
                          field.value?.filter((m) => m.userId !== member.userId)
                        );
                        const newMembers = form.getValues('newMembers');
                        const removedMembers =
                          form.getValues('removedMembers') ?? [];

                        form.setValue('removedMembers', [
                          ...removedMembers,
                          member,
                        ]);
                        form.setValue(
                          'newMembers',
                          newMembers?.filter((m) => m.userId !== member.userId)
                        );
                      }}
                    />
                  )}
                />
              </Grid>
              <Grid
                size={12}
                sx={{
                  marginTop: '1rem',
                }}
              >
                <SubmitButton label="Save" submittingLabel="Saving..." />
              </Grid>
            </form>
          </FormProvider>
        </Grid>
      </Grid>
    </>
  );
}
