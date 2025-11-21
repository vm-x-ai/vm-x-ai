'use client';

import { client as apiClient } from '@/clients/api/client.gen';
import { authInterceptor } from '@/clients/client-api-utils';
import { useMemo } from 'react';

export type OpenAPIClientProviderProps = {
  children: React.ReactNode;
  apiUrl: string;
};

export function OpenAPIClientProvider({
  children,
  apiUrl,
}: OpenAPIClientProviderProps) {
  // Set up clients for client-side API calls
  const clients = useMemo(() => {
    const clients = [{ client: apiClient, baseUrl: apiUrl }];

    for (const { client, baseUrl } of clients) {
      client.setConfig({
        baseUrl,
      });
    }

    return clients;
  }, [apiUrl]);

  useMemo(() => {
    for (const { client, baseUrl } of clients) {
      client.interceptors.request.use(authInterceptor);
      client.setConfig({
        baseUrl,
      });
    }

    return clients;
  }, [clients]);

  return <div>{children}</div>;
}
