import {
  zAiResourceModelConfigEntity,
  zAiResourceModelRoutingEntity,
} from '@/clients/api/zod.gen';
import type { FormActionUpdateState } from '@/types';
import { z } from 'zod';

export const schema = z.object({
  model: z.object(
    {
      ...zAiResourceModelConfigEntity.shape,
    },
    {
      error: 'Primary model is required.',
    }
  ),
  routing: zAiResourceModelRoutingEntity.optional(),
});

export type FormSchema = z.output<typeof schema>;

export type FormAction = FormActionUpdateState<
  FormSchema,
  { workspaceId: string; environmentId: string; resourceName: string }
>;
