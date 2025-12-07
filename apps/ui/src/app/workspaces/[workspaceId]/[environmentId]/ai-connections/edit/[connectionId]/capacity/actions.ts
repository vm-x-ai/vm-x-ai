'use server';

import { updateAiConnection } from '@/clients/api';
import {
  type FormSchema,
  type FormAction,
  schema,
} from '@/components/AIConnection/Form/Edit/Capacity';
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

  const { data: response, error } = await updateAiConnection({
    path: {
      workspaceId: prevState.pathParams.workspaceId,
      environmentId: prevState.pathParams.environmentId,
      connectionId: prevState.pathParams.connectionId,
    },
    body: {
      ...changes,
    },
  });

  revalidatePath(
    `/workspaces/${prevState.pathParams.workspaceId}/${prevState.pathParams.environmentId}/ai-connections/overview`
  );

  return {
    ...prevState,
    success: !!response,
    message: response
      ? 'Connection successfully updated!'
      : error?.errorMessage,
    changes,
  };
}
