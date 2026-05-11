import ModelPricingForm from '@/components/ModelPricing/Form';
import { submitForm } from './actions';

export const metadata = {
  title: 'VM-X AI Console - Settings - New Pricing',
  description: 'VM-X AI Console - Settings - New Pricing',
};

export default async function Page() {
  return <ModelPricingForm submitAction={submitForm} title="New Pricing" />;
}
