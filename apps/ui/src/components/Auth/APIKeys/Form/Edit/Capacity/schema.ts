import { zCapacityEntity } from '@/clients/api/zod.gen';
import { FormActionUpdateState } from '@/types';
import { z } from 'zod';

export const schema = z.object({
  enforceCapacity: z.boolean().optional(),
  capacity: z.array(zCapacityEntity).optional(),
});

export type FormSchema = z.output<typeof schema>;

export type FormAction = FormActionUpdateState<
  FormSchema,
  { workspaceId: string; environmentId: string; apiKeyId: string }
>;
