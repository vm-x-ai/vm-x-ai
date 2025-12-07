import TabContent from '@/components/Tabs/TabContent';

export const metadata = {
  title: 'VM-X AI Console - SDK',
  description: 'VM-X AI Console - SDK',
};

type LayoutProps = {
  children: React.ReactNode;
  params: {
    workspaceId: string;
    environmentId: string;
  };
};

export default async function Layout({ children }: LayoutProps) {
  return <TabContent>{children}</TabContent>;
}
