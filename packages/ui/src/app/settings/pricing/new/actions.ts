'use server';

import { modelPricingControllerCreateV1 } from '@/clients/api';
import {
  type FormSchema,
  type FormAction,
  schema,
} from '@/components/ModelPricing/schema';

export async function submitForm(
  prevState: FormAction,
  data: FormSchema
): Promise<FormAction> {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    return {
      ...prevState,
      success: false,
      message: 'Invalid form data',
      data,
    };
  }

  const { pricingId, ...payload } = parsed.data;
  void pricingId; // ignored on create

  const { data: response, error } = await modelPricingControllerCreateV1({
    body: {
      provider: payload.provider,
      model: payload.model,
      inputCostPerToken: payload.inputCostPerToken,
      outputCostPerToken: payload.outputCostPerToken,
      cachedInputCostPerToken: payload.cachedInputCostPerToken ?? null,
      reasoningCostPerToken: payload.reasoningCostPerToken ?? null,
    },
  });

  if (!response) {
    return {
      ...prevState,
      success: false,
      message:
        (error as { errorMessage?: string } | undefined)?.errorMessage ??
        'Failed to create pricing entry',
      data,
    };
  }

  return {
    ...prevState,
    success: true,
    message: 'Pricing entry created successfully',
    data,
    response: { pricingId: response.pricingId },
  };
}
