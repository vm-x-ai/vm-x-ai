'use client';

import {
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useEffect } from 'react';

export type ReactQueryClientProviderProps = {
  children: React.ReactNode;
};

const queryClient = new QueryClient();

export default function ReactQueryClientProvider({
  children,
}: ReactQueryClientProviderProps) {
  useEffect(() => {
    queryClient.setDefaultOptions({
      queries: {
        retry: false,
      },
    });
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ReactQueryDevtools />
    </QueryClientProvider>
  );
}
