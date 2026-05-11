'use client';

import Image, { type ImageProps } from 'next/image';
import type { AiProviderLogoDto } from '@/clients/api';
import { useResolvedColorScheme } from '@/hooks/use-resolved-color-scheme';
import { pickProviderLogoSrc } from '@/utils/provider';

export type ProviderLogoProps = Omit<ImageProps, 'src' | 'loader' | 'alt'> & {
  logo: AiProviderLogoDto | null | undefined;
  alt?: string;
  /** Fallback when `logo` is null/undefined. Defaults to rendering nothing. */
  fallback?: React.ReactNode;
};

/**
 * Renders an AI-provider logo, honoring the active MUI color scheme. Falls
 * back to the default `url` whenever the active scheme is light or the
 * provider hasn't shipped a `darkUrl`.
 *
 * Uses `useResolvedColorScheme` rather than `useTheme().palette.mode` —
 * with `cssVariables` + `colorSchemes` the latter stays pinned at the
 * default scheme regardless of which one is actually active.
 *
 * Provider URLs are absolute, served by the API from `/assets/logos/`, and
 * frequently cross-origin relative to the UI dev server — so we always pass
 * a passthrough `loader` to Next.js Image.
 */
export default function ProviderLogo({
  logo,
  alt = '',
  fallback = null,
  ...rest
}: ProviderLogoProps) {
  const colorScheme = useResolvedColorScheme();
  const src = pickProviderLogoSrc(logo, colorScheme);
  if (!src) return <>{fallback}</>;
  return <Image {...rest} src={src} alt={alt} loader={({ src }) => src} />;
}
