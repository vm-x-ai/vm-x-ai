'use client';

import Breadcrumbs from '@mui/material/Breadcrumbs';
import MUILink from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import { useRoutePattern } from '@/hooks/use-router-pattern';
import Link from 'next/link';
import type { ReadonlyURLSearchParams } from 'next/navigation';
import { useParams, usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Params } from 'next/dist/server/request/params';

export type GetTextGenerator = (
  param?: string,
  params?: Params,
  query?: ReadonlyURLSearchParams | null
) => Promise<string | null>;
export type GetDefaultTextGenerator = (path: string, href?: string) => string;

const _defaultGetTextGenerator: GetTextGenerator = async (
  _param?: string,
  _params?: Params,
  _query?: ReadonlyURLSearchParams | null
) => null;
const _defaultGetDefaultTextGenerator: GetDefaultTextGenerator = (
  path: string,
  _href?: string
) => path;

const generatePathParts = (pathStr: string | null) => {
  const pathWithoutQuery = pathStr?.split('?')?.[0] ?? '';
  return pathWithoutQuery.split('/').filter((v) => v.length > 0);
};

export type NextBreadcrumbsProps = {
  getTextGenerator?: GetTextGenerator;
  getDefaultTextGenerator?: GetDefaultTextGenerator;
};

export default function NextBreadcrumbs({
  getTextGenerator = _defaultGetTextGenerator,
  getDefaultTextGenerator = _defaultGetDefaultTextGenerator,
}: NextBreadcrumbsProps) {
  const pathname = usePathname();
  const query = useSearchParams();
  const params = useParams();
  const routePattern = useRoutePattern();

  const breadcrumbs = useMemo(
    function generateBreadcrumbs() {
      const asPathNestedRoutes = generatePathParts(pathname);
      const pathnameNestedRoutes = generatePathParts(routePattern);

      const crumblist = asPathNestedRoutes.map((subpath, idx) => {
        const param = pathnameNestedRoutes[idx]
          .replace('[', '')
          .replace(']', '');

        const href = '/' + asPathNestedRoutes.slice(0, idx + 1).join('/');
        return {
          href,
          textGenerator: () => getTextGenerator(param, params, query),
          text: getDefaultTextGenerator(subpath, href),
        };
      });

      return [{ href: '/', text: 'Home' }, ...crumblist];
    },
    [
      pathname,
      routePattern,
      getDefaultTextGenerator,
      getTextGenerator,
      params,
      query,
    ]
  );

  return (
    <Breadcrumbs aria-label="breadcrumb">
      {breadcrumbs.map((crumb, idx) => (
        <Crumb
          {...crumb}
          key={crumb.href}
          last={idx === breadcrumbs.length - 1}
        />
      ))}
    </Breadcrumbs>
  );
}

type CrumbProps = {
  text: string;
  textGenerator?: () => Promise<string | null>;
  href: string;
  last?: boolean;
};

function Crumb({
  text: defaultText,
  textGenerator,
  href,
  last = false,
}: CrumbProps) {
  const [text, setText] = useState(defaultText);

  useEffect(() => {
    if (!textGenerator) {
      return;
    }
    textGenerator().then((finalText) => {
      if (finalText) {
        setText(finalText);
      }
    });
  }, [textGenerator]);

  if (last) {
    return <Typography color="text.primary">{text}</Typography>;
  }

  return (
    <MUILink underline="hover" color="inherit" component={Link} href={href}>
      {text}
    </MUILink>
  );
}
