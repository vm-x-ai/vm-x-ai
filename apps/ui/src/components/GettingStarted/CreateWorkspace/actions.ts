'use server';

import { redirect } from 'next/navigation';
import type { FormSchema } from './schema';
import { schema } from './schema';
import { createWorkspace, WorkspaceEntity } from '@/clients/api';

export type FormState = {
  message: string;
  success?: boolean;
  data?: WorkspaceEntity;
};

export async function submitForm(
  prevState: FormState,
  data: FormSchema
): Promise<FormState> {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    return {
      success: false,
      message: 'Invalid form data',
    };
  }

  const { error, data: resp } = await createWorkspace({
    body: data,
  });

  if (error) {
    return {
      success: false,
      message: error.errorMessage,
    };
  }

  redirect(`/getting-started?workspaceId=${resp.workspaceId}`);
}
