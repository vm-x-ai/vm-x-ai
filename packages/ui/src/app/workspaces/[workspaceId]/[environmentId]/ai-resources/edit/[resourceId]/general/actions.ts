'use server';

import { updateAiResource } from '@/clients/api';
import {
  type FormSchema,
  type FormAction,
  schema,
} from '@/components/AIResources/Form/Edit/General';
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

  // The form keeps `defaultArgs` as a JSON string so the Monaco editor
  // can flag bad syntax inline. The server expects an object; parse here
  // (zod already validated it parses to an object) and forward.
  const { defaultArgsJson, ...rest } = changes;
  let defaultArgs: Record<string, unknown> | null | undefined = undefined;
  if (defaultArgsJson != null) {
    const trimmed = defaultArgsJson.trim();
    defaultArgs = trimmed === '' ? null : JSON.parse(trimmed);
  }

  const { error, data: response } = await updateAiResource({
    path: {
      workspaceId: prevState.pathParams.workspaceId,
      environmentId: prevState.pathParams.environmentId,
      resourceId: prevState.pathParams.resourceId,
    },
    body: {
      ...rest,
      ...(defaultArgs !== undefined ? { defaultArgs } : {}),
    },
  });

  revalidatePath(
    `/workspaces/${prevState.pathParams.workspaceId}/${prevState.pathParams.environmentId}/ai-resources/overview`
  );
  revalidatePath(
    `/workspaces/${prevState.pathParams.workspaceId}/${prevState.pathParams.environmentId}/ai-resources/edit/${prevState.pathParams.resourceId}/general`
  );

  return {
    ...prevState,
    success: !!response,
    message: response ? 'Resource successfully updated!' : error?.errorMessage,
    changes,
  };
}
