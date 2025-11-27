'use server';

import { createApiKey } from '@/clients/api';
import {
  type FormSchema,
  type FormAction,
  schema,
} from '@/components/Auth/APIKeys/Form/Create';
import { DEFAULT_CAPACITY } from '@/components/Capacity/consts';

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
  const { error, data: response } = await createApiKey({
    path: {
      workspaceId,
      environmentId,
    },
    body: {
      ...payload,
      enforceCapacity: false,
      capacity: DEFAULT_CAPACITY,
    },
  });

  return {
    ...prevState,
    success: !!response,
    message: response
      ? 'Role created successfully'
      : error?.errorMessage ?? 'Failed to create role',
    data,
    response: response,
  };
}
