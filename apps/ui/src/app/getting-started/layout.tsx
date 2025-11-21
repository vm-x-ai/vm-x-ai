import Header from '@/components/Header/Header';

export const metadata = {
  title: 'VM-X AI Console - Getting Started',
  description: 'VM-X AI Console - Getting Started',
};

type LayoutProps = {
  children: React.ReactNode;
};

export default async function Layout({ children }: LayoutProps) {
  return (
    <>
      <Header />
      <div className="mt-20 p-6">{children}</div>
    </>
  );
}
