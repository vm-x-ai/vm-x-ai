'use server';

import { updateWorkspace } from '@/clients/api';
import {
  type FormSchema,
  type FormAction,
  schema,
} from '@/components/Workspace/Form/Edit';

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

  const { workspaceId, ...payload } = data;

  const { error, data: response } = await updateWorkspace({
    path: {
      workspaceId,
    },
    body: {
      ...payload,
    },
  });

  return {
    ...prevState,
    success: !!response,
    message: response
      ? 'Workspace updated successfully'
      : error?.errorMessage ?? 'Failed to update workspace',
    data,
    response: response,
  };
}
