import TabContent from '@/components/Tabs/TabContent';

export const metadata = {
  title: 'VM-X AI Console - Edit AI Connection - Provider',
  description: 'VM-X AI Console - Edit AI Connection - Provider',
};

type LayoutProps = {
  children: React.ReactNode;
};

export default async function Layout({ children }: LayoutProps) {
  return <TabContent>{children}</TabContent>;
}
