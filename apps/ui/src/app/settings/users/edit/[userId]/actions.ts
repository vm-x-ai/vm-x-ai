'use server';

import { updateUser } from '@/clients/api';
import {
  type FormSchema,
  type FormAction,
  schema,
} from '@/components/Users/Form/Edit';

export async function submitForm(
  prevState: FormAction,
  data: FormSchema
): Promise<FormAction> {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    return {
      ...prevState,
      success: false,
      message: 'Invalid form data',
      data,
    };
  }

  const { id, confirmPassword, ...payload } = data;
  const { error, data: response } = await updateUser({
    path: {
      userId: id,
    },
    body: {
      ...payload,
      password:
        payload.password && payload.password.trim() !== ''
          ? payload.password
          : undefined,
    },
  });

  if (!response) {
    return {
      ...prevState,
      success: false,
      message: error?.errorMessage ?? 'Failed to update user',
      data,
    };
  }

  return {
    ...prevState,
    success: true,
    message: 'User updated successfully',
    data,
    response: response,
  };
}
