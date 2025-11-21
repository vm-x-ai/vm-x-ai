export { auth as proxy } from '@/auth';
import { ensureServerClientsInitialized } from '@/clients/server-api-utils';

ensureServerClientsInitialized();

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
