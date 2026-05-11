'use server';

import { updateAiResource } from '@/clients/api';
import type { UpdateAiResourceDto } from '@/clients/api';
import { zUpdateAiResourceDto } from '@/clients/api/zod.gen';
import {
  type FormSchema,
  type FormAction,
  schema,
} from '@/components/AIResources/Form/Edit/Advanced';
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

  // The string already passed the "is JSON object" refine in the
  // form schema; here we run it through the API's zod DTO to catch
  // shape errors before the network round-trip.
  let parsedJson: Record<string, unknown>;
  try {
    parsedJson = JSON.parse(parsed.data.resourceJson);
  } catch (error) {
    return {
      ...prevState,
      success: false,
      message: `Could not parse JSON: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
      changes,
    };
  }

  const dto = zUpdateAiResourceDto.safeParse(parsedJson);
  if (!dto.success) {
    return {
      ...prevState,
      success: false,
      message: `JSON does not match the AI Resource schema: ${dto.error.issues
        .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
        .join('; ')}`,
      changes,
    };
  }

  const { error, data: response } = await updateAiResource({
    path: {
      workspaceId: prevState.pathParams.workspaceId,
      environmentId: prevState.pathParams.environmentId,
      resourceId: prevState.pathParams.resourceId,
    },
    // The generated zod parses to literal-string enums while the
    // hand-rolled type alias `UpdateAiResourceDto` uses string-enum
    // refs (RoutingOperator, RoutingAction). Both shapes describe
    // identical wire payloads — the cast bridges the literal-vs-enum
    // mismatch without weakening the runtime check that already ran.
    body: dto.data as UpdateAiResourceDto,
  });

  revalidatePath(
    `/workspaces/${prevState.pathParams.workspaceId}/${prevState.pathParams.environmentId}/ai-resources/overview`
  );
  revalidatePath(
    `/workspaces/${prevState.pathParams.workspaceId}/${prevState.pathParams.environmentId}/ai-resources/edit/${prevState.pathParams.resourceId}/advanced`
  );

  return {
    ...prevState,
    success: !!response,
    message: response ? 'Resource successfully updated!' : error?.errorMessage,
    changes,
  };
}
