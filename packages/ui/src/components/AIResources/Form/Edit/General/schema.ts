import { zAiResourceModelConfigEntity } from '@/clients/api/zod.gen';
import type { FormActionUpdateState } from '@/types';
import { z } from 'zod';

export const schema = z.object({
  name: z.string({
    error: 'Name is required.',
  }),
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
  // JSON string holding a `Record<string, unknown>` of default request
  // arguments (e.g. `reasoning_effort`, `temperature`). The save action
  // parses it; we keep it as a string in the form so the Monaco editor
  // can show invalid-JSON markers while the user edits.
  defaultArgsJson: z
    .string()
    .optional()
    .refine(
      (value) => {
        if (!value || value.trim() === '') return true;
        try {
          const parsed = JSON.parse(value);
          return (
            parsed !== null &&
            typeof parsed === 'object' &&
            !Array.isArray(parsed)
          );
        } catch {
          return false;
        }
      },
      { error: 'Default args must be a JSON object.' }
    ),
});

export type FormSchema = z.output<typeof schema>;

export type FormAction = FormActionUpdateState<
  FormSchema,
  { workspaceId: string; environmentId: string; resourceId: string }
>;
