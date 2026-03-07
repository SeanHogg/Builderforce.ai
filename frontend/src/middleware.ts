import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Routes that require a valid web token (any authenticated user)
const AUTH_REQUIRED = ['/tenants', '/dashboard'];

// Routes that additionally require a tenant token
const TENANT_REQUIRED = ['/dashboard'];

// Public routes – never redirect
const PUBLIC_ROUTES = ['/', '/login', '/register'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow /projects/* through (client-side auth guard handles it)
  if (pathname.startsWith('/projects/')) {
    return NextResponse.next();
  }

  const isAuthRequired = AUTH_REQUIRED.some(
    (r) => pathname === r || pathname.startsWith(`${r}/`)
  );
  const isTenantRequired = TENANT_REQUIRED.some(
    (r) => pathname === r || pathname.startsWith(`${r}/`)
  );

  if (!isAuthRequired) return NextResponse.next();

  // Read tokens from cookies (set by client code via document.cookie)
  const webToken = request.cookies.get('bf_web_token')?.value;
  const tenantToken = request.cookies.get('bf_tenant_token')?.value;

  if (!webToken) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  if (isTenantRequired && !tenantToken) {
    const url = request.nextUrl.clone();
    url.pathname = '/tenants';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/tenants/:path*'],
};
