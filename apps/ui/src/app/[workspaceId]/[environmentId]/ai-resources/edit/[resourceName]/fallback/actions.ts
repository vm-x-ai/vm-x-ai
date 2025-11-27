'use server';

import { updateAiResource } from '@/clients/api';
import {
  type FormSchema,
  type FormAction,
  schema,
} from '@/components/AIResources/Form/Edit/Fallback';
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

  const { error, data: response } = await updateAiResource({
    path: {
      workspaceId: prevState.pathParams.workspaceId,
      environmentId: prevState.pathParams.environmentId,
      resource: prevState.pathParams.resourceName,
    },
    body: {
      ...changes,
    },
  });

  revalidatePath(
    `/${prevState.pathParams.workspaceId}/${prevState.pathParams.environmentId}/ai-resources/overview`
  );
  revalidatePath(
    `/${prevState.pathParams.workspaceId}/${prevState.pathParams.environmentId}/ai-resources/edit/${prevState.pathParams.resourceName}/fallback`
  );

  return {
    ...prevState,
    success: !!response,
    message: response ? 'Resource successfully updated!' : error?.errorMessage,
    changes,
  };
}
