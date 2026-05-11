import type { FormActionUpdateState } from '@/types';
import { z } from 'zod';

/**
 * Advanced edit form keeps the entire UpdateAiResourceDto payload as
 * a single JSON string so the Monaco editor can flag bad syntax /
 * shape mismatches inline. The submit action does the actual JSON
 * parse + zod validation against the generated `zUpdateAiResourceDto`
 * before forwarding to the API — keeping the heavy schema off the
 * client bundle and the round-trip identical to the per-section forms.
 */
export const schema = z.object({
  resourceJson: z.string().refine(
    (value) => {
      if (!value || value.trim() === '') return false;
      try {
        const parsed = JSON.parse(value);
        return parsed !== null && typeof parsed === 'object';
      } catch {
        return false;
      }
    },
    { error: 'Body must be a valid JSON object.' }
  ),
});

export type FormSchema = z.output<typeof schema>;

export type FormAction = FormActionUpdateState<
  FormSchema,
  { workspaceId: string; environmentId: string; resourceId: string }
>;
