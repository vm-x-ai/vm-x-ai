import ModelPricingTable from '@/components/ModelPricing/Table';
import TabContent from '@/components/Tabs/TabContent';

export const metadata = {
  title: 'VM-X AI Console - Settings - Pricing',
  description: 'VM-X AI Console - Settings - Pricing',
};

export default async function Page() {
  return (
    <TabContent>
      <ModelPricingTable />
    </TabContent>
  );
}
