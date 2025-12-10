import NextAuth, {
  DefaultSession,
  NextAuthConfig,
  NextAuthResult,
} from 'next-auth';
import { DefaultJWT, JWT } from 'next-auth/jwt';

let refreshingPromise: Promise<JWT> | null = null;

const result = NextAuth({
  trustHost: true,
  pages: {
    signIn: '/api/signin',
  },
  providers: [
    {
      id: 'vm-x-ai',
      name: 'VM-X AI OIDC Provider',
      type: 'oidc',
      issuer: process.env.AUTH_OIDC_ISSUER,
      clientId: process.env.AUTH_OIDC_CLIENT_ID,
      clientSecret: process.env.AUTH_OIDC_CLIENT_SECRET,
      authorization: {
        params: {
          prompt: 'consent',
          scope: 'openid profile email offline_access',
        },
      },
      profile(profile) {
        return {
          id: profile.sub,
          username: profile.username,
          name: profile.name,
          firstName: profile.firstName,
          lastName: profile.lastName,
          email: profile.email,
          picture: profile.picture,
        };
      },
    },
  ],
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    authorized({ auth, request }) {
      if (
        request.nextUrl.pathname.startsWith('/api/auth') ||
        request.nextUrl.pathname.startsWith('/api/federated/sign-out')
      ) {
        return true;
      }

      return !!auth?.user && !auth?.user?.error;
    },
    async jwt({ token, account, profile }) {
      if (account) {
        return {
          name: token.name,
          email: token.email,
          sub: profile?.sub,
          picture: token.picture,
          expiresAt: account.expires_at ? account.expires_at * 1000 : undefined,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          idToken: account.id_token,
        };
      } else if (Date.now() < token.expiresAt) {
        return token;
      } else {
        try {
          if (refreshingPromise) {
            return await refreshingPromise;
          }

          refreshingPromise = refreshToken(token);
          return await refreshingPromise;
        } catch (error) {
          console.error('Error refreshing token', error);
          return {
            ...token,
            error: (error as Error).message,
          };
        }
      }
    },
    session({ session, token, user }) {
      session.accessToken = token.accessToken;
      session.idToken = token.idToken;
      session.expires = new Date(token.expiresAt).toISOString() as Date & string;
      if (token.error && typeof token.error === 'string') {
        session.user.error = token.error;
      }
      session.user.userId = token.sub;
      return session;
    },
  } as NextAuthConfig['callbacks'],
});

declare module 'next-auth' {
  interface Session extends DefaultSession {
    accessToken?: string;
    idToken?: string;
  }

  interface User {
    error?: string;
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    userId?: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT extends DefaultJWT {
    expiresAt: number;
    accessToken: string;
    idToken: string;
  }
}

async function refreshToken(token: JWT): Promise<JWT> {
  console.log('Refreshing token');
  console.log('Fetching OpenID configuration');
  const openidConfiguration = await fetch(
    `${process.env.AUTH_OIDC_ISSUER}/.well-known/openid-configuration`
  );
  if (!openidConfiguration.ok) {
    throw new Error(
      `Failed to fetch OpenID configuration: ${await openidConfiguration.text()}`
    );
  }
  const openidConfigurationData = await openidConfiguration.json();
  console.log('OpenID configuration fetched');
  const tokenEndpoint = openidConfigurationData.token_endpoint;

  console.log('Requesting new token');
  const clientId = process.env.AUTH_OIDC_CLIENT_ID;
  const clientSecret = process.env.AUTH_OIDC_CLIENT_SECRET;
  const credentials = `${clientId}:${clientSecret}`;
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: token.refreshToken as string,
  }).toString();

  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    body,
    headers: {
      Authorization: `Basic ${Buffer.from(credentials).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to refresh token: ${await response.text()}`);
  }

  const responseData = await response.json();
  const expiresAt = new Date(
    Date.now() + responseData.expires_in * 1000
  ).getTime();
  console.log('New token received');
  return {
    ...token,
    accessToken: responseData.access_token,
    idToken: responseData.id_token,
    refreshToken: responseData.refresh_token,
    expiresAt,
  };
}

export const handlers: NextAuthResult['handlers'] = result.handlers;
export const auth: NextAuthResult['auth'] = result.auth;
export const signIn: NextAuthResult['signIn'] = result.signIn;
export const signOut: NextAuthResult['signOut'] = result.signOut;
