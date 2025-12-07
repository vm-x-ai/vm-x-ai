import { WorkspaceEntity } from '@/clients/api';
import type { FormActionState } from '@/types';
import { z } from 'zod';

export const schema = z.object({
  workspaceId: z.string(),
  environmentId: z.string(),
  name: z
    .string({
      error: 'Environment name is required.',
    })
    .trim()
    .min(3, { message: 'Environment name must be at least 3 characters long.' }),
  description: z.string().optional(),
});

export type FormSchema = z.output<typeof schema>;

export type FormAction = FormActionState<FormSchema, WorkspaceEntity>;
