import AppContainer from '../Layout/Container';

export type TabContentProps = {
  children: React.ReactNode;
};

export default function TabContent({ children }: TabContentProps) {
  return <AppContainer>{children}</AppContainer>;
}
