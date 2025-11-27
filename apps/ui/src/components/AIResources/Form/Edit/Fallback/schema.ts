import { zAiResourceModelConfigEntity } from '@/clients/api/zod.gen';
import type { FormActionUpdateState } from '@/types';
import { z } from 'zod';

export const schema = z.object({
  useFallback: z.boolean(),
  fallbackModels: z.array(zAiResourceModelConfigEntity).optional(),
});

export type FormSchema = z.output<typeof schema>;

export type FormAction = FormActionUpdateState<
  FormSchema,
  { workspaceId: string; environmentId: string; resourceName: string }
>;
