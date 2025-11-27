import { Session } from 'next-auth';
import { getSession } from 'next-auth/react';

let sessionPromise: Promise<Session | null> | null = null;
let expiresAt: Date | null = null;

export async function getToken() {
  if (!sessionPromise || !expiresAt || expiresAt < new Date()) {
    sessionPromise = getSession();
  }

  const session = await sessionPromise;
  expiresAt = session?.expires ? new Date(session.expires) : null;
  return session?.accessToken;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function authInterceptor(config: any) {
  const accessToken = await getToken();
  config.headers.set('Authorization', `Bearer ${accessToken}`);
}
