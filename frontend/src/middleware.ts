import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Route protection rules:
 *
 * PUBLIC  (no auth required):
 *   /              Landing page
 *   /workforce     Agent registry
 *   /login         Sign-in
 *   /register      Sign-up
 *
 * WEB-TOKEN required (signed in, no tenant selected yet):
 *   /tenants       Tenant selector
 *
 * WEB-TOKEN + TENANT-TOKEN required (fully authenticated):
 *   /dashboard/**  User dashboard
 *   /projects/**   IDE & project management
 *   /training/**   AI model training panel
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const webToken = request.cookies.get('bf_web_token')?.value;
  const tenantToken = request.cookies.get('bf_tenant_token')?.value;

  // Helper: redirect to login with next param
  const toLogin = () => {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  };

  // Helper: redirect to tenant selector with next param
  const toTenants = () => {
    const url = request.nextUrl.clone();
    url.pathname = '/tenants';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  };

  // /tenants — requires sign-in only
  if (pathname.startsWith('/tenants')) {
    if (!webToken) return toLogin();
    return NextResponse.next();
  }

  // Fully-authenticated routes: /dashboard, /projects, /training
  if (
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/projects') ||
    pathname.startsWith('/training')
  ) {
    if (!webToken) return toLogin();
    if (!tenantToken) return toTenants();
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/tenants/:path*',
    '/projects/:path*',
    '/training/:path*',
  ],
};
