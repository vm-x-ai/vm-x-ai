import TabContent from '@/components/Tabs/TabContent';

export const metadata = {
  title: 'VM-X AI Console - Security - Auth - Edit Role - Capacity',
  description: 'VM-X AI Console - Security - Auth - Edit Role - Capacity',
};

type LayoutProps = {
  children: React.ReactNode;
};

export default async function Layout({ children }: LayoutProps) {
  return <TabContent>{children}</TabContent>;
}
