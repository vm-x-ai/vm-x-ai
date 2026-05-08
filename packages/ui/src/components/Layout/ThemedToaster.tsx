'use client';

import { ToastContainer } from 'react-toastify';
import { useResolvedColorScheme } from '@/hooks/use-resolved-color-scheme';

/**
 * `<ToastContainer>` accepts `theme` as a prop but it's a client-side
 * value — the root layout is a server component, so resolving the
 * active scheme has to happen here in a small client wrapper. Using
 * `useResolvedColorScheme` (not `useTheme().palette.mode`) is required
 * for the same reason as `<ProviderLogo>`: the JS theme `mode` is
 * pinned at the default scheme when MUI is configured with
 * `cssVariables` + `colorSchemes`.
 */
export default function ThemedToaster() {
  const scheme = useResolvedColorScheme();
  return <ToastContainer position="top-center" theme={scheme} closeOnClick />;
}
