import AppContainer from '@/components/Layout/Container';

export const metadata = {
  title: 'VM-X AI Console - Edit AI Connection',
  description: 'VM-X AI Console - Edit AI Connection',
};

type LayoutProps = {
  children: React.ReactNode;
};

export default function Layout({ children }: LayoutProps) {
  return <AppContainer>{children}</AppContainer>;
}
