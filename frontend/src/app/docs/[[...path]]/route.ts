import type { NextRequest } from 'next/server';

export const runtime = 'edge';

const DOCS_ORIGIN = 'https://builderforce-docs.pages.dev';

type RouteContext = {
  params: Promise<{ path?: string[] }>;
};

/**
 * Same-origin proxy for the separately deployed Astro documentation site.
 *
 * A Next external rewrite used to forward `/docs/foo` to the Pages deployment
 * as `/foo`. Cloudflare Pages canonicalizes that directory to `/foo/`, but its
 * Location header cannot know about the stripped public prefix. Browsers then
 * followed the redirect to `/foo/` on the main app and landed on a 404 (or an
 * unrelated app route). Fetching the canonical upstream directory URL here
 * avoids that redirect and lets us repair any other upstream Location header.
 */
async function proxyDocs(request: NextRequest, context: RouteContext): Promise<Response> {
  const { path = [] } = await context.params;
  const encodedPath = path.map(encodeURIComponent).join('/');
  const upstream = new URL(`/${encodedPath}`, DOCS_ORIGIN);

  // Astro emits pages as `<route>/index.html`. Request the directory form so
  // Pages serves it directly instead of redirecting and dropping `/docs`.
  if (!encodedPath || !/\.[^/]+$/.test(encodedPath)) {
    upstream.pathname = `${upstream.pathname.replace(/\/$/, '')}/`;
  }
  upstream.search = request.nextUrl.search;

  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.delete('content-length');

  const upstreamResponse = await fetch(upstream, {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    redirect: 'manual',
  });

  const responseHeaders = new Headers(upstreamResponse.headers);
  const location = responseHeaders.get('location');
  if (location?.startsWith('/')) {
    responseHeaders.set('location', `/docs${location}`);
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
}

export const GET = proxyDocs;
export const HEAD = proxyDocs;
export const POST = proxyDocs;
export const PUT = proxyDocs;
export const PATCH = proxyDocs;
export const DELETE = proxyDocs;
export const OPTIONS = proxyDocs;
