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
import { WorkspaceEntity, WorkspaceUserDto } from '@/clients/api';
import MembersTable from './MembersTable';

export type WorkspaceEditFormProps = {
  workspace: WorkspaceEntity;
  members: WorkspaceUserDto[];
  submitAction: (
    prevState: FormAction,
    data: FormSchema
  ) => Promise<FormAction>;
};

export default function WorkspaceEditForm({
  submitAction,
  workspace,
  members,
}: WorkspaceEditFormProps) {
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
      router.push(`/workspaces`);
    }
  }, [router, state]);

  const form = useForm<FormSchema>({
    resolver: zodResolver(schema as never),
    defaultValues: {
      workspaceId: workspace.workspaceId,
      name: workspace.name,
      description: workspace.description ?? '',
      members: members,
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
                <Typography variant="h6">Edit Workspace</Typography>
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
                        label="Workspace Name"
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
              <Grid size={12}>
                <Controller
                  name="members"
                  control={form.control}
                  render={({ field }) => (
                    <MembersTable
                      value={field.value}
                      onUpdateMemberRole={(member) => {
                        field.onChange(
                          field.value?.map((m) =>
                            m.userId === member.userId ? member : m
                          )
                        );

                        const newMembers = form.getValues('newMembers') ?? [];
                        const updatedMembers =
                          form.getValues('updatedMembers') ?? [];

                        const newMember = newMembers.find(
                          (m) => m.userId === member.userId
                        );

                        if (newMember) {
                          form.setValue(
                            'newMembers',
                            newMembers.map((m) =>
                              m.userId === member.userId ? member : m
                            )
                          );
                          return;
                        }

                        const existingMember = updatedMembers.find(
                          (m) => m.userId === member.userId
                        );

                        form.setValue(
                          'updatedMembers',
                          existingMember
                            ? updatedMembers.map((m) =>
                                m.userId === member.userId ? member : m
                              )
                            : [...updatedMembers, member]
                        );
                      }}
                      onAddMember={(member) => {
                        field.onChange([...(field.value ?? []), member]);

                        const removedMembers =
                          form.getValues('removedMembers') ?? [];

                        const removedMember = removedMembers.find(
                          (m) => m.userId === member.userId
                        );
                        if (removedMember) {
                          form.setValue(
                            'removedMembers',
                            removedMembers.filter(
                              (m) => m.userId !== member.userId
                            )
                          );

                          if (removedMember.role !== member.role) {
                            form.setValue('updatedMembers', [
                              ...(form.getValues('updatedMembers') ?? []),
                              member,
                            ]);
                          }
                          return;
                        }

                        form.setValue('newMembers', [
                          ...(form.getValues('newMembers') ?? []),
                          member,
                        ]);
                      }}
                      onRemoveMember={(member) => {
                        field.onChange(
                          field.value?.filter((m) => m.userId !== member.userId)
                        );
                        const newMembers = form.getValues('newMembers');
                        const updatedMembers =
                          form.getValues('updatedMembers') ?? [];
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
                        form.setValue(
                          'updatedMembers',
                          updatedMembers.filter(
                            (m) => m.userId !== member.userId
                          )
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
