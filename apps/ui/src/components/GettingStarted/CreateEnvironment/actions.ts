'use server';

import { redirect } from 'next/navigation';
import type { FormSchema } from './schema';
import { schema } from './schema';
import { createEnvironment } from '@/clients/api';

export type FormState = {
  workspaceId: string;
  message: string;
  success?: boolean;
  apiKeyValue?: string;
};

export async function submitForm(
  prevState: FormState,
  data: FormSchema
): Promise<FormState> {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    return {
      ...prevState,
      success: false,
      message: 'Invalid form data',
    };
  }

  const { error, data: resp } = await createEnvironment({
    path: {
      workspaceId: prevState.workspaceId,
    },
    body: data,
  });

  if (error) {
    return {
      ...prevState,
      success: false,
      message: error.errorMessage,
    };
  }

  redirect(
    `/getting-started?workspaceId=${resp.workspaceId}&environmentId=${resp.environmentId}`
  );
}
