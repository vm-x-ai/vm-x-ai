import TabContent from '@/components/Tabs/TabContent';

export const metadata = {
  title: 'VM-X AI Console - Insights - Audit',
  description: 'VM-X AI Console - Insights - Audit',
};

type LayoutProps = {
  children: React.ReactNode;
};

export default async function Layout({ children }: LayoutProps) {
  return <TabContent>{children}</TabContent>;
}
