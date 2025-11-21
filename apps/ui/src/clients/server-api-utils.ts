import { redirect } from 'next/navigation';
import { client as apiClient } from '@/clients/api/client.gen';
import { auth } from '@/auth';

async function getToken() {
  const session = await auth();
  if (!session) {
    redirect('/api/signin');
  }

  return session?.accessToken;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function serverAuthInterceptor(config: any) {
  const accessToken = await getToken();
  if (config.headers.has('Authorization')) {
    return;
  }

  config.headers.set('Authorization', `Bearer ${accessToken}`);
}

let initialized = false;

export function ensureServerClientsInitialized() {
  if (initialized) {
    return;
  }

  // Set up clients for server-side API calls
  for (const { client, baseUrl } of [
    {
      client: apiClient,
      baseUrl: process.env.API_BASE_URL as string,
    },
  ]) {
    client.setConfig({
      baseUrl,
    });
    client.interceptors.request.use(serverAuthInterceptor);
  }

  initialized = true;
}
