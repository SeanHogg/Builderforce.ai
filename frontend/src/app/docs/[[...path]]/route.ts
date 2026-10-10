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
/**
 * Root-absolute links inside a documentation page, re-homed under `/docs`.
 *
 * Astro prefixes its own navigation and assets with `base: '/docs'`, but it does
 * NOT touch links written in the Markdown, and the content is authored against
 * the docs site's own root (`[Agent send](/tools/agent-send)`). On the public
 * origin those resolved to the APP: `/tools/agent-send` is the free-diagnostics
 * page, which asked the API for a tool called `agent-send` and logged
 * `404 Unknown tool` for every click. A link already under `/docs`, and a
 * protocol-relative `//host` link, are left alone.
 */
const ROOT_LINK = /(\shref=["'])\/(?!\/|docs(?:[/"'?#]|$))/g;

function rehomeDocsLinks(html: string): string {
  return html.replace(ROOT_LINK, '$1/docs/');
}

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

  if (responseHeaders.get('content-type')?.includes('text/html')) {
    // The body is re-encoded from the rewritten text, so the upstream's encoding
    // and length no longer describe it.
    responseHeaders.delete('content-encoding');
    responseHeaders.delete('content-length');
    return new Response(rehomeDocsLinks(await upstreamResponse.text()), {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
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
