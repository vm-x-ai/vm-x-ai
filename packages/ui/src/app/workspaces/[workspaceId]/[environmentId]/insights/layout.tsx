export const metadata = {
  title: 'VM-X AI Console - Insights',
  description: 'VM-X AI Console - Insights',
};

type LayoutProps = {
  children: React.ReactNode;
};

/**
 * Insights used to wrap its children in a `SubTabs` left rail with
 * Audit/Usage tabs. Those tabs now live inside the main sidebar (under
 * the `Insights` workspace item) so the page body keeps its full width
 * — at viewports below ~1400px the audit table no longer overflows.
 *
 * The layout is kept (rather than deleted) so we still surface the
 * route's metadata title for browser history / tab-name purposes.
 */
export default async function Layout({ children }: LayoutProps) {
  return <>{children}</>;
}
