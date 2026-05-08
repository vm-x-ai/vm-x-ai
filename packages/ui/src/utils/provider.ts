import { AiProviderDto, AiProviderLogoDto } from '@/clients/api';

export const mapProviders = (
  providers: AiProviderDto[]
): Record<string, AiProviderDto> => {
  return providers.reduce<Record<string, AiProviderDto>>((acc, provider) => {
    acc[provider.id] = provider;
    return acc;
  }, {});
};

/**
 * Picks the right logo URL for the active theme. Falls back to `url` when
 * no `darkUrl` is configured (most providers ship a single mark that works
 * on either background; only OpenAI and Perplexity have a dark variant).
 *
 * Pure function so it can be called inside `.map()` row renderers without
 * tripping React's rules-of-hooks. Pass `palette.mode` from the calling
 * component's `useTheme()`.
 */
export const pickProviderLogoSrc = (
  logo: AiProviderLogoDto | null | undefined,
  themeMode: 'light' | 'dark'
): string | undefined => {
  if (!logo) return undefined;
  if (themeMode === 'dark' && logo.darkUrl) return logo.darkUrl;
  return logo.url;
};
