'use client';

import type { ReadonlyURLSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import titleize from 'titleize';
import NextBreadcrumbs from '../NextBreadcrumbs';
import {
  EnvironmentEntity,
  getAiConnectionById,
  getAiResourceById,
  getApiKeyById,
  WorkspaceEntity,
} from '@/clients/api';
import { Params } from 'next/dist/server/request/params';

export type BreadcrumbsProps = {
  workspace?: WorkspaceEntity;
  environment?: EnvironmentEntity;
};

/**
 * Friendly labels for route segments whose `titleize`d form is wrong
 * — `sdk` → `Sdk`, `ai-connections` → `Ai-Connections`. The keys here
 * win before the generic `titleize` fallback runs. Only segments that
 * are *not* dynamic params land here (dynamic ones go through
 * `getTextGenerator` below).
 */
const ROUTE_SEGMENT_LABELS: Record<string, string> = {
  sdk: 'SDK',
  'ai-connections': 'AI Connections',
  'ai-resources': 'AI Resources',
};

export default function Breadcrumbs({
  workspace,
  environment,
}: BreadcrumbsProps) {
  const getDefaultTextGenerator = useCallback((subpath: string) => {
    return ROUTE_SEGMENT_LABELS[subpath] ?? titleize(subpath);
  }, []);

  const getTextGenerator = useCallback(
    async (
      param?: string,
      params?: Params,
      _query?: ReadonlyURLSearchParams | null
    ) => {
      const resolverMap: Record<string, () => Promise<string | null>> = {
        timestamp: async () => {
          // Guard against `decodeURIComponent(undefined)` (which
          // throws `URIError`) and against malformed URI components
          // a hand-edited URL might supply.
          const raw = params?.timestamp;
          if (typeof raw !== 'string') return null;
          try {
            return new Date(decodeURIComponent(raw)).toLocaleString();
          } catch {
            return null;
          }
        },
        workspaceId: async () => {
          return `Workspace [${workspace?.name ?? params?.workspaceId}]`;
        },
        environmentId: async () => {
          return `Environment [${environment?.name ?? params?.environmentId}]`;
        },
        connectionId: async () => {
          const id = params?.connectionId as string | undefined;
          if (!id || !workspace?.workspaceId || !environment?.environmentId) {
            return null;
          }
          const response = await getAiConnectionById({
            path: {
              workspaceId: workspace.workspaceId,
              environmentId: environment.environmentId,
              connectionId: id,
            },
          });
          // Fall back to the raw ID rather than rendering
          // `Connection [undefined]` when the API returns a 404 or
          // omits `name` for any reason.
          return `Connection [${response.data?.name ?? id}]`;
        },
        roleId: async () => {
          const id = params?.roleId as string | undefined;
          if (!id || !workspace?.workspaceId || !environment?.environmentId) {
            return null;
          }
          const response = await getApiKeyById({
            path: {
              workspaceId: workspace.workspaceId,
              environmentId: environment.environmentId,
              apiKeyId: id,
            },
          });
          return `Role [${response.data?.name ?? id}]`;
        },
        resourceId: async () => {
          const id = params?.resourceId as string | undefined;
          if (!id || !workspace?.workspaceId || !environment?.environmentId) {
            return null;
          }
          const response = await getAiResourceById({
            path: {
              workspaceId: workspace.workspaceId,
              environmentId: environment.environmentId,
              resourceId: id,
            },
          });
          return `AI Resource [${response.data?.name ?? id}]`;
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
