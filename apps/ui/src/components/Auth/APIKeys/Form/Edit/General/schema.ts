import type { FormActionUpdateState } from '@/types';
import { z } from 'zod';

export const schema = z.object({
  name: z
    .string({
      error: 'API Key name is required.',
    })
    .trim()
    .min(3, { message: 'API Key name must be at least 3 characters long.' }),
  description: z.string().nullish(),
  enabled: z.boolean(),
  resources: z.array(z.string()),
  labels: z.array(z.string()).nullish(),
});

export type FormSchema = z.output<typeof schema>;

export type FormAction = FormActionUpdateState<
  FormSchema,
  { workspaceId: string; environmentId: string; apiKeyId: string }
>;
