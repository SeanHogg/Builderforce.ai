import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { VSCODE_WEBVIEW_SCHEME } from '@/lib/embed/embedTrust';

/**
 * Route protection rules:
 *
 * PUBLIC (no auth): /, /product, /pricing, /blog, /agents, /marketplace,
 *   /prompts, /login, /register.
 *
 * WEB-TOKEN required: /tenants (tenant selector → login when logged out).
 *
 * Feature routes (/dashboard, /ide, /projects, /training, /tasks, /workforce,
 *   /chats, /brainstorm, /content-manager, /skills, /personas, /approvals,
 *   /security, /settings, /debug, …): when logged OUT we let the
 *   request through so the client renders a marketing teaser + login/CTA
 *   (RouteMarketing) rather than redirecting; signed-in-but-no-tenant → /tenants.
 */
// Cross-origin isolation for the in-browser IDE. WebContainer needs
// `self.crossOriginIsolated === true` to transfer a SharedArrayBuffer to its
// worker; that requires COOP:same-origin + COEP:credentialless on the IDE
// document. public/_headers + next.config.js set these for static/prerendered
// routes, but @cloudflare/next-on-pages applies _headers ONLY to static assets
// and does NOT reliably emit next.config headers() for dynamically-rendered
// (SSR) routes. `/ide/[id]` is SSR (it fetches the project), so it slipped
// through both and booted un-isolated — failing with "not cross-origin
// isolated". Middleware runs in the Worker for matched routes and DOES apply to
// the SSR response, so we set the headers here for the IDE routes. Scoped to
// /ide on purpose: blanket credentialless on /embed/* or auth-popup routes can
// break credentialed cross-origin frames.
const COI_HEADERS: Record<string, string> = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};
function withCoi(res: NextResponse): NextResponse {
  for (const [k, v] of Object.entries(COI_HEADERS)) res.headers.set(k, v);
  return res;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const needsCoi = pathname === '/ide' || pathname.startsWith('/ide/');

  // Embedded surfaces (/embed/*) are framed cross-origin by host apps (e.g.
  // BurnRateOS). They authenticate via postMessage (not cookies), so we must NOT
  // auth-redirect them, AND we must allow the configured hosts to frame them via
  // a `frame-ancestors` CSP (the single NEXT_PUBLIC_EMBED_ALLOWED_HOST_ORIGINS
  // allowlist also gates the client-side postMessage trust check in useEmbedFrame).
  if (pathname === '/embed' || pathname.startsWith('/embed/')) {
    const res = NextResponse.next();
    const allowed = (process.env.NEXT_PUBLIC_EMBED_ALLOWED_HOST_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    // Also allow the BuilderForce VS Code extension (webviews load from a random
    // `vscode-webview://<guid>` origin) to frame /embed — trust the scheme, since the
    // embed is useless without the tenant token the extension hands it via postMessage.
    res.headers.set(
      'Content-Security-Policy',
      `frame-ancestors 'self' ${VSCODE_WEBVIEW_SCHEME} ${allowed.join(' ')}`.trim(),
    );
    res.headers.delete('X-Frame-Options');
    return res;
  }

  // Observability moved onto the Workforce page as tabs; redirect the old route
  // and its legacy aliases (/logs, /timeline) to the Workforce Logs tab.
  if (
    pathname === '/observability' || pathname.startsWith('/observability/') ||
    pathname === '/logs' || pathname.startsWith('/logs/') ||
    pathname === '/timeline' || pathname.startsWith('/timeline/')
  ) {
    const url = request.nextUrl.clone();
    url.pathname = '/workforce';
    url.search = '?tab=logs';
    return NextResponse.redirect(url);
  }

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
    '/contributors',
    '/brainstorm',
    '/content-manager',
    '/skills',
    '/personas',
    '/security',
    '/settings',
    '/debug',
  ];
  const isProtected = protectedPaths.some((p) => pathname === p || pathname.startsWith(p + '/'));

  if (isProtected) {
    // Logged out → DON'T redirect to login. Let the request through so the app
    // renders a per-route marketing teaser + login/CTA (ConditionalAppShell +
    // RouteMarketing), instead of bouncing the visitor or showing a blank gate.
    if (!webToken) return needsCoi ? withCoi(NextResponse.next()) : NextResponse.next();
    // Signed in but no workspace selected → tenant picker.
    if (!tenantToken) return toTenants();
    return needsCoi ? withCoi(NextResponse.next()) : NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/embed/:path*',
    '/logs/:path*',
    '/timeline/:path*',
    '/dashboard/:path*',
    '/ide',
    '/ide/:path*',
    '/tenants/:path*',
    '/projects/:path*',
    '/training/:path*',
    '/tasks/:path*',
    '/workforce/:path*',
    '/contributors/:path*',
    '/brainstorm/:path*',
    '/content-manager/:path*',
    '/skills/:path*',
    '/personas/:path*',
    '/security/:path*',
    '/settings/:path*',
    '/observability/:path*',
    '/debug/:path*',
  ],
};
