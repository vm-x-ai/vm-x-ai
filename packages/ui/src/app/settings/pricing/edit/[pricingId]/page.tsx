import Alert from '@mui/material/Alert';
import ModelPricingForm from '@/components/ModelPricing/Form';
import { modelPricingControllerGetV1 } from '@/clients/api';
import { submitForm } from './actions';

export const metadata = {
  title: 'VM-X AI Console - Settings - Edit Pricing',
  description: 'VM-X AI Console - Settings - Edit Pricing',
};

export type PageProps = {
  params: Promise<{ pricingId: string }>;
};

export default async function Page({ params }: PageProps) {
  const { pricingId } = await params;
  const { data, error } = await modelPricingControllerGetV1({
    path: { pricingId },
  });

  if (error || !data) {
    return (
      <Alert variant="filled" severity="error">
        Failed to fetch pricing entry:{' '}
        {(error as { errorMessage?: string } | undefined)?.errorMessage ??
          'not found'}
      </Alert>
    );
  }

  return (
    <ModelPricingForm
      submitAction={submitForm}
      title={`Edit Pricing — ${data.provider}/${data.model}`}
      initialValues={{
        pricingId: data.pricingId,
        provider: data.provider,
        model: data.model,
        inputCostPerToken: data.inputCostPerToken,
        outputCostPerToken: data.outputCostPerToken,
        cachedInputCostPerToken: data.cachedInputCostPerToken ?? null,
        reasoningCostPerToken: data.reasoningCostPerToken ?? null,
      }}
    />
  );
}
