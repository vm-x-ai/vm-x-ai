import type { FormActionUpdateState } from '@/types';
import { z } from 'zod';

export const schema = z.object({
  name: z
    .string({
      error: 'Connection name is required.',
    })
    .min(3)
    .trim(),
  description: z.string({
    error: 'Description is required.',
  }),
});

export type FormSchema = z.output<typeof schema>;

export type FormAction = FormActionUpdateState<
  FormSchema,
  { workspaceId: string; environmentId: string; connectionId: string }
>;
