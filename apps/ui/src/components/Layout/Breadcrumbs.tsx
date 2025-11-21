'use client';

import type { ReadonlyURLSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import titleize from 'titleize';
import NextBreadcrumbs from '../NextBreadcrumbs';
import {
  EnvironmentEntity,
  getAiConnectionById,
  getApiKeyById,
  WorkspaceEntity,
} from '@/clients/api';
import { Params } from 'next/dist/server/request/params';

export type BreadcrumbsProps = {
  workspace?: WorkspaceEntity;
  environment?: EnvironmentEntity;
};

export default function Breadcrumbs({
  workspace,
  environment,
}: BreadcrumbsProps) {
  const getDefaultTextGenerator = useCallback((subpath: string) => {
    return titleize(subpath);
  }, []);

  const getTextGenerator = useCallback(
    async (
      param?: string,
      params?: Params,
      _query?: ReadonlyURLSearchParams | null
    ) => {
      const resolverMap: Record<string, () => Promise<string | null>> = {
        timestamp: async () => {
          return new Date(
            decodeURIComponent(params?.timestamp as string)
          ).toLocaleString();
        },
        workspaceId: async () => {
          return `Workspace [${workspace?.name}]`;
        },
        environmentId: async () => {
          return `Environment [${environment?.name}]`;
        },
        connectionId: async () => {
          const response = await getAiConnectionById({
            path: {
              workspaceId: workspace?.workspaceId ?? '',
              environmentId: environment?.environmentId ?? '',
              connectionId: params?.connectionId as string,
            },
          });

          return `Connection [${response.data?.name}]`;
        },
        roleId: async () => {
          const response = await getApiKeyById({
            path: {
              workspaceId: workspace?.workspaceId ?? '',
              environmentId: environment?.environmentId ?? '',
              apiKeyId: params?.roleId as string,
            },
          });

          return `Role [${response.data?.name}]`;
        },
      };
      return resolverMap[param ?? '']?.() ?? null;
    },
    [
      environment?.environmentId,
      environment?.name,
      workspace?.name,
      workspace?.workspaceId,
    ]
  );

  return (
    <NextBreadcrumbs
      getDefaultTextGenerator={getDefaultTextGenerator}
      getTextGenerator={getTextGenerator}
    />
  );
}
