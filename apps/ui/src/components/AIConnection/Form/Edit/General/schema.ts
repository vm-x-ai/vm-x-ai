import type { FormActionUpdateState } from '@vm-x-ai/console-ui/types';
import { z } from 'zod';

export const schema = z.object({
  name: z
    .string({
      required_error: 'Connection name is required.',
    })
    .min(3)
    .trim(),
  description: z.string({
    required_error: 'Description is required.',
  }),
});

export type FormSchema = z.output<typeof schema>;

export type FormAction = FormActionUpdateState<
  FormSchema,
  { workspaceId: string; environmentId: string; connectionId: string }
>;
