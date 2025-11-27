import { CapacityEntity } from '@/clients/api';
import { zCapacityEntity } from '@/clients/api/zod.gen';
import { FormActionUpdateState } from '@/types';
import { z } from 'zod';

export const schema = z.object({
  capacity: z.array(zCapacityEntity),
});

export type FormSchema = z.output<typeof schema> & {
  capacity: CapacityEntity[];
};

export type FormAction = FormActionUpdateState<
  FormSchema,
  { workspaceId: string; environmentId: string; connectionId: string }
>;
