import { z } from 'zod';

/**
 * Form schema for the Settings → Pricing create/edit forms. Mirrors
 * `ModelPricingEntity` server-side, with the per-token costs entered
 * as decimal numbers (USD/token). The Usage page consumes these
 * values to compute the cost column on every audit row.
 */
export const schema = z.object({
  pricingId: z.string().optional(),
  provider: z.string().min(1, 'Provider is required'),
  model: z.string().min(1, 'Model is required'),
  inputCostPerToken: z
    .number({ error: 'Must be a number' })
    .nonnegative('Must be ≥ 0'),
  outputCostPerToken: z
    .number({ error: 'Must be a number' })
    .nonnegative('Must be ≥ 0'),
  // `null` = explicit "not set"; `undefined` = uninitialised field.
  // Both round-trip cleanly because the API DTO is optional+nullable.
  cachedInputCostPerToken: z
    .number({ error: 'Must be a number' })
    .nonnegative('Must be ≥ 0')
    .nullable()
    .optional(),
  reasoningCostPerToken: z
    .number({ error: 'Must be a number' })
    .nonnegative('Must be ≥ 0')
    .nullable()
    .optional(),
});

export type FormSchema = z.infer<typeof schema>;

export type FormAction = {
  message: string;
  success?: boolean;
  data?: FormSchema;
  response?: { pricingId: string };
};
