import './global.css';
import 'react-toastify/dist/ReactToastify.css';

import React from 'react';
import { AppRouterCacheProvider } from '@mui/material-nextjs/v16-appRouter';
import { ThemeProvider } from '@mui/material/styles';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import theme from './theme';
import { OpenAPIClientProvider } from '@/providers/openapi-client.provider';
import ReactQueryClientProvider from '@/providers/query-client.provider';
import { ensureServerClientsInitialized } from '@/clients/server-api-utils';
import { SessionProvider } from 'next-auth/react';
import { ToastContainer } from 'react-toastify';

export const metadata = {
  title: 'VM-X AI Console',
  description: 'VM-X AI Console',
};

ensureServerClientsInitialized();

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        style={{
          backgroundColor:
            'var(--mui-palette-AppBar-darkBg, var(--mui-palette-AppBar-defaultBg))',
        }}
      >
        <AppRouterCacheProvider options={{ enableCssLayer: true }}>
          <NuqsAdapter>
            <OpenAPIClientProvider apiUrl={process.env.API_BASE_URL as string}>
              <ReactQueryClientProvider>
                <ToastContainer
                  position="top-center"
                  theme="light"
                  closeOnClick
                />
                <ThemeProvider theme={theme}>
                  <SessionProvider>
                    <main>{children}</main>
                  </SessionProvider>
                </ThemeProvider>
              </ReactQueryClientProvider>
            </OpenAPIClientProvider>
          </NuqsAdapter>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
