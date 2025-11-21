import { Session } from 'next-auth';
import { getSession } from 'next-auth/react';

let sessionPromise: Promise<Session | null> | null = null;

export async function getToken() {
  if (!sessionPromise) {
    sessionPromise = getSession();
  }

  const session = await sessionPromise;
  return session?.accessToken;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function authInterceptor(config: any) {
  const accessToken = await getToken();
  config.headers.set('Authorization', `Bearer ${accessToken}`);
}
