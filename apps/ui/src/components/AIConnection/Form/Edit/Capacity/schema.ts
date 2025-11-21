import type { FormActionUpdateState } from '@vm-x-ai/console-ui/types';
import type { Capacity } from '@vm-x-ai/shared-capacity/dto';
import { z } from 'zod';

export const schema = z.object({
  capacity: z.array(
    z.object({
      period: z.string(),
      requests: z.number(),
      tokens: z.number(),
      enabled: z.boolean(),
    }),
  ),
});

export type FormSchema = z.output<typeof schema> & {
  capacity: Capacity[];
};

export type FormAction = FormActionUpdateState<
  FormSchema,
  { workspaceId: string; environmentId: string; connectionId: string }
>;
