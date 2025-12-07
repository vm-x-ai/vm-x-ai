'use server';

import {
  type FormSchema,
  type FormAction,
} from '@/components/AIConnection/Form/Edit/Provider';
import { updateAiConnection } from '@/clients/api';
import { revalidatePath } from 'next/cache';

export async function submitForm(
  prevState: FormAction,
  formData: FormSchema
): Promise<FormAction> {
  const { providersMap, ...changes } = formData;
  const { error, data: response } = await updateAiConnection({
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
