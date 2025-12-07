'use server';

import { createAiResource } from '@/clients/api';
import {
  type FormSchema,
  type FormAction,
  schema,
} from '@/components/AIResources/Form/Create/schema';

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
  const { data: response, error } = await createAiResource({
    path: {
      workspaceId,
      environmentId,
    },
    body: {
      ...payload,
      enforceCapacity: false,
      useFallback: false,
    },
  });

  return {
    ...prevState,
    success: !!response,
    message: response ? 'Resource created successfully' : error?.errorMessage,
    data,
    response: response,
  };
}
