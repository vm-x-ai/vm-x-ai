type LayoutProps = {
  children: React.ReactNode;
};

/**
 * Security used to wrap children in a `SubTabs` left rail with a
 * single `Roles` tab. That nav now lives in the main sidebar (under
 * `Security`), so the page body keeps its full width.
 *
 * The role-edit sub-tabs (`General Settings`, `Capacity`) for a
 * specific role still render as horizontal tabs inside the role-edit
 * page itself — those are scoped to a single role and don't belong in
 * the global sidebar.
 */
export default function Layout({ children }: LayoutProps) {
  return <>{children}</>;
}
