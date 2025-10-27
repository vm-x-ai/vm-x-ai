import { randomBytes } from 'crypto';
import * as jose from 'node-jose';
import { JWKS } from 'oidc-provider';

export function generateCookieKeys(count = 3): string[] {
  return Array.from({ length: count }, () => {
    // Generate 32 bytes (256 bits) of random data
    return randomBytes(32).toString('base64');
  });
}

export async function generateJWKS(): Promise<JWKS> {
  const keystore = jose.JWK.createKeyStore();

  const kid = randomBytes(32).toString('base64');

  // Generate RSA key for signing
  await keystore.generate('RSA', 2048, {
    use: 'sig',
    alg: 'RS256',
    kid,
  });

  return keystore.toJSON(true) as JWKS;
}

// Usage
generateJWKS().then((jwks) => {
  console.log(
    `OIDC_PROVIDER_JWKS=${Buffer.from(JSON.stringify(jwks, null, 2)).toString(
      'base64'
    )}`
  );
  console.log(
    `OIDC_PROVIDER_COOKIE_KEYS=${Buffer.from(
      JSON.stringify(generateCookieKeys(3), null, 2)
    ).toString('base64')}`
  );
});
