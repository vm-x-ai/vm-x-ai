'use server';

import { updateApiKey } from '@/clients/api';
import {
  type FormSchema,
  type FormAction,
  schema,
} from '@/components/Auth/APIKeys/Form/Edit/General';
import { revalidatePath } from 'next/cache';

export async function submitForm(
  prevState: FormAction,
  changes: FormSchema
): Promise<FormAction> {
  const parsed = schema.safeParse(changes);
  if (!parsed.success) {
    return {
      ...prevState,
      success: false,
      message: 'Invalid form data',
      changes,
    };
  }

  const { error, data: response } = await updateApiKey({
    path: {
      workspaceId: prevState.pathParams.workspaceId,
      environmentId: prevState.pathParams.environmentId,
      apiKeyId: prevState.pathParams.apiKeyId,
    },
    body: {
      ...changes,
    },
  });

  revalidatePath(
    `/workspaces/${prevState.pathParams.workspaceId}/${prevState.pathParams.environmentId}/security/auth/role/overview`
  );

  return {
    ...prevState,
    success: !!response,
    message: response ? 'Role successfully updated!' : error?.errorMessage,
    changes,
  };
}
