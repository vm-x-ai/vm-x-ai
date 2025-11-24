import { CapacityEntity } from '@/clients/api';
import { FormActionUpdateState } from '@/types';
import { z } from 'zod';

export const schema = z.object({
  capacity: z.array(
    z.object({
      period: z.string(),
      requests: z.number().nullish(),
      tokens: z.number().nullish(),
      enabled: z.boolean().nullish(),
      dimension: z.string().nullish(),
    })
  ),
});

export type FormSchema = z.output<typeof schema> & {
  capacity: CapacityEntity[];
};

export type FormAction = FormActionUpdateState<
  FormSchema,
  { workspaceId: string; environmentId: string; connectionId: string }
>;
