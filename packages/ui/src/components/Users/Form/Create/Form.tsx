'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Alert from '@mui/material/Alert';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import SubmitButton from '@/components/Form/SubmitButton';
import { useRouter } from 'next/navigation';
import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Controller, FormProvider, useForm } from 'react-hook-form';
import { toast } from 'react-toastify';
import { schema } from './schema';
import type { FormSchema, FormAction } from './schema';
import InputAdornment from '@mui/material/InputAdornment';
import IconButton from '@mui/material/IconButton';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import RoleSelector from './RoleSelector';
import { UserState } from '@/clients/api';
import FormGroup from '@mui/material/FormGroup';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';

export type CreateUserFormProps = {
  submitAction: (
    prevState: FormAction,
    data: FormSchema
  ) => Promise<FormAction>;
};

export default function CreateUserForm({ submitAction }: CreateUserFormProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [state, formAction] = useActionState(submitAction, {
    message: '',
    data: undefined,
    success: undefined,
  });

  useEffect(() => {
    if (state.success && state.response) {
      toast.success(state.message);
      router.push(`/settings/users`);
    }
  }, [router, state]);

  const form = useForm<FormSchema>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      firstName: '',
      lastName: '',
      email: '',
      username: '',
      password: '',
      confirmPassword: '',
      roleIds: [],
      state: UserState.CHANGE_PASSWORD,
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
                <Typography variant="h6">New User</Typography>
                <Divider />
              </Grid>
              <Grid container size={12}>
                <Grid container size={6} spacing={3}>
                  <Grid size={6}>
                    <Controller
                      name="firstName"
                      control={form.control}
                      render={({ field }) => (
                        <TextField
                          {...field}
                          variant="outlined"
                          margin="normal"
                          fullWidth
                          label="First Name"
                          error={!!form.formState.errors.firstName?.message}
                          helperText={form.formState.errors.firstName?.message}
                        />
                      )}
                    />
                  </Grid>
                  <Grid size={6}>
                    <Controller
                      name="lastName"
                      control={form.control}
                      render={({ field }) => (
                        <TextField
                          {...field}
                          variant="outlined"
                          margin="normal"
                          fullWidth
                          label="Last Name"
                          onBlur={() => {
                            if (form.watch('name') === '') {
                              form.setValue(
                                'name',
                                `${form.watch('firstName')} ${form.watch(
                                  'lastName'
                                )}`
                              );
                            }
                          }}
                          error={!!form.formState.errors.lastName?.message}
                          helperText={form.formState.errors.lastName?.message}
                        />
                      )}
                    />
                  </Grid>
                  <Grid size={12}>
                    <Controller
                      name="name"
                      control={form.control}
                      render={({ field }) => (
                        <TextField
                          {...field}
                          variant="outlined"
                          margin="normal"
                          fullWidth
                          label="Display Name"
                          error={!!form.formState.errors.name?.message}
                          helperText={form.formState.errors.name?.message}
                        />
                      )}
                    />
                  </Grid>
                </Grid>
              </Grid>
              <Grid container size={12}>
                <Grid size={12}>
                  <Typography variant="subtitle2">Authentication</Typography>
                  <Divider />
                  <Typography variant="caption">
                    Enter the email and password for the user.
                  </Typography>
                </Grid>
                <Grid container size={12}>
                  <Grid size={6}>
                    <Controller
                      name="email"
                      control={form.control}
                      render={({ field }) => (
                        <TextField
                          {...field}
                          variant="outlined"
                          margin="normal"
                          fullWidth
                          label="Email"
                          error={!!form.formState.errors.email?.message}
                          helperText={form.formState.errors.email?.message}
                        />
                      )}
                    />
                  </Grid>
                </Grid>
                <Grid container size={12}>
                  <Grid container size={6} spacing={3}>
                    <Grid size={6}>
                      <Controller
                        name="password"
                        control={form.control}
                        render={({ field }) => (
                          <TextField
                            {...field}
                            variant="outlined"
                            margin="normal"
                            type={showPassword ? 'text' : 'password'}
                            fullWidth
                            label={
                              form.watch('state') === UserState.CHANGE_PASSWORD
                                ? 'Initial Password'
                                : 'Password'
                            }
                            error={!!form.formState.errors.password?.message}
                            helperText={form.formState.errors.password?.message}
                            slotProps={{
                              input: {
                                endAdornment: (
                                  <InputAdornment position="end">
                                    <IconButton
                                      onClick={() => {
                                        setShowPassword(!showPassword);
                                      }}
                                    >
                                      {showPassword ? (
                                        <Visibility />
                                      ) : (
                                        <VisibilityOff />
                                      )}
                                    </IconButton>
                                  </InputAdornment>
                                ),
                              },
                            }}
                          />
                        )}
                      />
                    </Grid>
                    <Grid size={6}>
                      <Controller
                        name="confirmPassword"
                        control={form.control}
                        render={({ field }) => (
                          <TextField
                            {...field}
                            variant="outlined"
                            margin="normal"
                            type={showPassword ? 'text' : 'password'}
                            fullWidth
                            label={
                              form.watch('state') === UserState.CHANGE_PASSWORD
                                ? 'Confirm Initial Password'
                                : 'Confirm Password'
                            }
                            error={
                              !!form.formState.errors.confirmPassword?.message
                            }
                            helperText={
                              form.formState.errors.confirmPassword?.message
                            }
                            slotProps={{
                              input: {
                                endAdornment: (
                                  <InputAdornment position="end">
                                    <IconButton
                                      onClick={() => {
                                        setShowConfirmPassword(
                                          !showConfirmPassword
                                        );
                                      }}
                                    >
                                      {showConfirmPassword ? (
                                        <Visibility />
                                      ) : (
                                        <VisibilityOff />
                                      )}
                                    </IconButton>
                                  </InputAdornment>
                                ),
                              },
                            }}
                          />
                        )}
                      />
                    </Grid>
                  </Grid>
                </Grid>
              </Grid>
              <Grid container size={12}>
                <Grid size={12}>
                  <Controller
                    name="state"
                    control={form.control}
                    render={({ field }) => (
                      <FormGroup>
                        <FormControlLabel
                          control={
                            <Checkbox
                              checked={
                                field.value === UserState.CHANGE_PASSWORD
                              }
                              onChange={(e) =>
                                field.onChange(
                                  e.target.checked
                                    ? UserState.CHANGE_PASSWORD
                                    : UserState.ACTIVE
                                )
                              }
                            />
                          }
                          label="Require password change on next login"
                        />
                      </FormGroup>
                    )}
                  />
                </Grid>
              </Grid>
              <Grid container size={12} spacing={3}>
                <Grid size={12}>
                  <Typography variant="subtitle2">Roles</Typography>
                  <Divider />
                  <Typography variant="caption">
                    Select the roles you want to assign to the user.
                  </Typography>
                </Grid>
                <Grid container size={12}>
                  <Grid size={6}>
                    <Controller
                      name="roleIds"
                      control={form.control}
                      render={({ field }) => (
                        <RoleSelector
                          {...field}
                          onChange={(value) => field.onChange(value)}
                        />
                      )}
                    />
                  </Grid>
                </Grid>
              </Grid>
              <Grid size={12} marginTop="1rem">
                <SubmitButton label="Save" submittingLabel="Saving..." />
              </Grid>
            </form>
          </FormProvider>
        </Grid>
      </Grid>
    </>
  );
}
