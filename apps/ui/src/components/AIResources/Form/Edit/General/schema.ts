import { zAiResourceModelConfigEntity } from '@/clients/api/zod.gen';
import type { FormActionUpdateState } from '@/types';
import { z } from 'zod';

export const schema = z.object({
  resource: z.string(),
  description: z.string({
    error: 'Description is required.',
  }),
  model: z.object(
    {
      ...zAiResourceModelConfigEntity.shape,
    },
    {
      error: 'Primary model is required.',
    }
  ),
});

export type FormSchema = z.output<typeof schema>;

export type FormAction = FormActionUpdateState<
  FormSchema,
  { workspaceId: string; environmentId: string; resourceName: string }
>;
