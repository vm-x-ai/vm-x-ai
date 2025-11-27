'use server';

import { CapacityEntity, updateAiResource } from '@/clients/api';
import {
  type FormSchema,
  type FormAction,
  schema,
} from '@/components/AIResources/Form/Edit/Capacity';
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
      capacity: changes.capacity as CapacityEntity[],
    },
  });

  revalidatePath(
    `/${prevState.pathParams.workspaceId}/${prevState.pathParams.environmentId}/ai-resources/overview`
  );
  revalidatePath(
    `/${prevState.pathParams.workspaceId}/${prevState.pathParams.environmentId}/ai-resources/edit/${prevState.pathParams.resourceName}/capacity`
  );

  return {
    ...prevState,
    success: !!response,
    message: response ? 'Resource successfully updated!' : error?.errorMessage,
    changes,
  };
}
