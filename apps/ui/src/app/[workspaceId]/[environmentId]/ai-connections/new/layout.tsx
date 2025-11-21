import TabContent from '@/components/Tabs/TabContent';

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
