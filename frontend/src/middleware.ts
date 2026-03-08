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
 *   /dashboard, /ide, /projects, /training, /tasks, /workforce, /chats,
 *   /brainstorm, /content-manager, /skills, /personas, /pricing, /security,
 *   /settings, /logs, /timeline, /debug
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const webToken = request.cookies.get('bf_web_token')?.value;
  const tenantToken = request.cookies.get('bf_tenant_token')?.value;

  const toLogin = () => {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  };

  const toTenants = () => {
    const url = request.nextUrl.clone();
    url.pathname = '/tenants';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  };

  if (pathname.startsWith('/tenants')) {
    if (!webToken) return toLogin();
    return NextResponse.next();
  }

  const protectedPaths = [
    '/dashboard',
    '/ide',
    '/projects',
    '/training',
    '/tasks',
    '/workforce',
    '/chats',
    '/brainstorm',
    '/content-manager',
    '/skills',
    '/personas',
    '/pricing',
    '/security',
    '/settings',
    '/logs',
    '/timeline',
    '/debug',
  ];
  const isProtected = protectedPaths.some((p) => pathname === p || pathname.startsWith(p + '/'));

  if (isProtected) {
    if (!webToken) return toLogin();
    if (!tenantToken) return toTenants();
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/ide',
    '/tenants/:path*',
    '/projects/:path*',
    '/training/:path*',
    '/tasks/:path*',
    '/workforce/:path*',
    '/chats/:path*',
    '/brainstorm/:path*',
    '/content-manager/:path*',
    '/skills/:path*',
    '/personas/:path*',
    '/pricing/:path*',
    '/security/:path*',
    '/settings/:path*',
    '/logs/:path*',
    '/timeline/:path*',
    '/debug/:path*',
  ],
};
