import type { FormActionUpdateState } from '@vm-x-ai/console-ui/types';
import { z } from 'zod';
import { applyProviderValidation, ProviderFieldsetFormSchema } from '../../Common/schema';

export const schema = applyProviderValidation(
  z.object({
    ...ProviderFieldsetFormSchema.shape,
  }),
);

export type FormSchema = z.output<typeof schema>;

export type FormAction = FormActionUpdateState<
  FormSchema,
  { workspaceId: string; environmentId: string; connectionId: string }
>;
