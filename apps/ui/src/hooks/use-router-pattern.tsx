import { usePathname } from 'next/navigation';

export const useRoutePattern = () => {
  const pathname = usePathname();
  const routePatterns = [
    '/getting-started',
    '/workspaces/[workspaceId]/[environmentId]/ai-connections/edit/[connectionId]',
    '/workspaces/[workspaceId]/[environmentId]/ai-resources/edit/[resourceId]',
    '/workspaces/[workspaceId]/[environmentId]/security/auth/role/edit/[roleId]',
    '/workspaces/[workspaceId]/[environmentId]',
    '/workspaces/[workspaceId]',
  ];

  for (const pattern of routePatterns) {
    const regExp = new RegExp(
      `^${pattern
        .split('/')
        .map((part) =>
          part
            .replace(/\//g, '\\/')
            .replace(/\[.*\]/g, '[^\\/]')
            .replace(/\]/g, ']+'),
        )
        .join('/')}`,
    );
    const match = pathname ? regExp.exec(pathname) : null;
    if (pathname && match) {
      return pattern + pathname.slice(match[0].length);
    }
  }

  return pathname;
};
