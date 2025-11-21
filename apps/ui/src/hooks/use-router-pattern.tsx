import { usePathname } from 'next/navigation';

export const useRoutePattern = () => {
  const pathname = usePathname();
  const routePatterns = [
    '/[workspaceId]/[environmentId]/ai-connections/edit/[connectionId]',
    '/[workspaceId]/[environmentId]/ai-resources/edit/[resourceName]',
    '/[workspaceId]/[environmentId]/security/auth/role/edit/[roleId]',
    '/[workspaceId]/[environmentId]/insights/benchmark/view/[timestamp]',
    '/[workspaceId]/[environmentId]',
    '/[workspaceId]',
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
