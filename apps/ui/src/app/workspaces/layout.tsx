import Layout from '@/components/Layout/Layout';

type LayoutProps = {
  children: React.ReactNode;
};

export default async function WorkspaceLayout({ children }: LayoutProps) {
  return (
    <Layout>
      <div className="mt-18">{children}</div>
    </Layout>
  );
}
