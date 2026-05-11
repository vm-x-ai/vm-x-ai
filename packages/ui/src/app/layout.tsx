import './global.css';
import 'react-toastify/dist/ReactToastify.css';

import React from 'react';
import { AppRouterCacheProvider } from '@mui/material-nextjs/v16-appRouter';
import InitColorSchemeScript from '@mui/material/InitColorSchemeScript';
import { ThemeProvider } from '@mui/material/styles';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import theme from './theme';
import { OpenAPIClientProvider } from '@/providers/openapi-client.provider';
import ReactQueryClientProvider from '@/providers/query-client.provider';
import { ensureServerClientsInitialized } from '@/clients/server-api-utils';
import { SessionProvider } from 'next-auth/react';
import ThemedToaster from '@/components/Layout/ThemedToaster';
import { ZustandStoreProvider } from '@/store/provider';

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
    // `suppressHydrationWarning` is the canonical fix for the
    // `InitColorSchemeScript` mismatch — that script writes
    // `data-mui-color-scheme` / `data-light` / `data-dark` onto the
    // <html> tag before React hydrates so the user's stored mode wins
    // first paint. The attributes intentionally don't exist in the
    // server output, so React would otherwise log a console error on
    // every page load.
    <html lang="en" suppressHydrationWarning>
      <body
        style={{
          backgroundColor:
            'var(--mui-palette-AppBar-darkBg, var(--mui-palette-AppBar-defaultBg))',
        }}
      >
        {/*
          Inline script that sets the html `data-mui-color-scheme` attribute
          based on localStorage *before* React hydrates. Without this the
          first paint always uses the default scheme and there's a brief
          flash when a user with dark-mode preference loads the page.
        */}
        <InitColorSchemeScript attribute="data" defaultMode="light" />
        <AppRouterCacheProvider options={{ enableCssLayer: true }}>
          <NuqsAdapter>
            <ZustandStoreProvider>
              <OpenAPIClientProvider
                apiUrl={process.env.API_BASE_URL as string}
              >
                <ReactQueryClientProvider>
                  <ThemeProvider theme={theme}>
                    <ThemedToaster />
                    <SessionProvider>
                      <main>{children}</main>
                    </SessionProvider>
                  </ThemeProvider>
                </ReactQueryClientProvider>
              </OpenAPIClientProvider>
            </ZustandStoreProvider>
          </NuqsAdapter>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
