import { AiProviderDto } from '@/clients/api';

export const mapProviders = (
  providers: AiProviderDto[]
): Record<string, AiProviderDto> => {
  return providers.reduce<Record<string, AiProviderDto>>((acc, provider) => {
    acc[provider.id] = provider;
    return acc;
  }, {});
};
