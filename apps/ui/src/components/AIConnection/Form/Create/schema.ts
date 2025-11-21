import { z } from 'zod';
import {
  applyProviderValidation,
  ProviderFieldsetFormSchema,
} from '../Common/schema';
import { FormActionState } from '@/types';
import {
  AiConnectionEntity,
  AiResourceEntity,
} from '@/clients/api';
import { ApiResponse } from '@/clients/types';

export const quickSchema = z.object({
  formType: z.literal('quick'),
  workspaceId: z.string(),
  environmentId: z.string(),
  name: z.string(),
  assignApiKeys: z.array(z.string()).default([]),
  providers: z.array(
    z.object({
      ...ProviderFieldsetFormSchema.shape,
    })
  ),
});

export type QuickFormSchema = z.output<typeof quickSchema>;

export const advancedSchema = applyProviderValidation(
  z.object({
    ...ProviderFieldsetFormSchema.shape,
    formType: z.literal('advanced'),
    workspaceId: z.string(),
    environmentId: z.string(),
    name: z
      .string({
        error: 'Connection name is required.',
      })
      .min(3)
      .trim(),
    description: z.string({
      error: 'Description is required.',
    }),
    assignApiKeys: z.array(z.string()).default([]),
  })
);

export type AdvancedFormSchema = z.output<typeof advancedSchema>;

export const schema = z.union([advancedSchema, quickSchema]);

export type FormType = 'quick' | 'advanced';

export type FormSchema = z.output<typeof schema>;

export type FormAction = FormActionState<
  FormSchema,
  {
    connections: {
      request: { name: string; provider: string };
      response: ApiResponse<AiConnectionEntity>;
    }[];
    resources?: {
      request: { name: string };
      response: ApiResponse<AiResourceEntity>;
    }[];
  }
>;
