'use server';

import { updateEnvironment } from '@/clients/api';
import {
  type FormSchema,
  type FormAction,
  schema,
} from '@/components/Environment/Form/Edit';

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

  const { workspaceId, environmentId, ...payload } = data;

  const { error, data: response } = await updateEnvironment({
    path: {
      workspaceId,
      environmentId,
    },
    body: {
      ...payload,
    },
  });

  return {
    ...prevState,
    success: !!response,
    message: response
      ? 'Environment updated successfully'
      : error?.errorMessage ?? 'Failed to update environment',
    data,
    response: response,
  };
}
