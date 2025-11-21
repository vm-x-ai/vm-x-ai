import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const idToken = request.nextUrl.searchParams.get('id_token');
  const response = await fetch(
    `${process.env.AUTH_OIDC_ISSUER}/.well-known/openid-configuration`
  );
  const data = await response.json();
  if (data.end_session_endpoint) {
    return NextResponse.redirect(
      `${
        data.end_session_endpoint
      }?post_logout_redirect_uri=${encodeURIComponent(
        request.nextUrl.origin
      )}&id_token_hint=${idToken}`
    );
  }

  return NextResponse.redirect(new URL('/', request.url));
}
