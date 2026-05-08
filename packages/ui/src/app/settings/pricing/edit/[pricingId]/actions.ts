'use server';

import { modelPricingControllerUpdateV1 } from '@/clients/api';
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
  if (!parsed.success || !data.pricingId) {
    return {
      ...prevState,
      success: false,
      message: 'Invalid form data',
      data,
    };
  }

  const { pricingId, ...payload } = parsed.data;
  if (!pricingId) {
    return {
      ...prevState,
      success: false,
      message: 'Pricing ID missing — unable to update',
      data,
    };
  }

  const { data: response, error } = await modelPricingControllerUpdateV1({
    path: { pricingId },
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
        'Failed to update pricing entry',
      data,
    };
  }

  return {
    ...prevState,
    success: true,
    message: 'Pricing entry updated successfully',
    data,
    response: { pricingId: response.pricingId },
  };
}
