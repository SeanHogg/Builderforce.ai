import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('/docs proxy', () => {
  it('requests the canonical upstream directory URL for a documentation page', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('<h1>Docs</h1>', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(
      new NextRequest('https://builderforce.ai/docs/agents-overview?lang=en'),
      { params: Promise.resolve({ path: ['agents-overview'] }) },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      new URL('https://builderforce-docs.pages.dev/agents-overview/?lang=en'),
      expect.objectContaining({ method: 'GET', redirect: 'manual' }),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Docs');
  });

  it('does not append a slash to static asset paths', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('asset', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await GET(
      new NextRequest('https://builderforce.ai/docs/_astro/site.css'),
      { params: Promise.resolve({ path: ['_astro', 'site.css'] }) },
    );

    expect(fetchMock.mock.calls[0]?.[0]).toEqual(
      new URL('https://builderforce-docs.pages.dev/_astro/site.css'),
    );
  });

  it('restores the public prefix on an upstream relative redirect', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, {
      status: 308,
      headers: { location: '/start/getting-started/' },
    })));

    const response = await GET(
      new NextRequest('https://builderforce.ai/docs/getting-started'),
      { params: Promise.resolve({ path: ['getting-started'] }) },
    );

    expect(response.headers.get('location')).toBe('/docs/start/getting-started/');
  });

  it('re-homes root-absolute content links under /docs so they do not land on app routes', async () => {
    const html = '<a href="/tools/agent-send">Agent send</a> <a href="/docs/cli/agent">CLI</a>'
      + ' <a href="//cdn.example.com/x">cdn</a> <a href="https://builderforce.ai/pricing">abs</a> <a href=\'/gateway/remote\'>remote</a>';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(html, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8', 'content-length': String(html.length) },
    })));

    const response = await GET(
      new NextRequest('https://builderforce.ai/docs/cli/agent'),
      { params: Promise.resolve({ path: ['cli', 'agent'] }) },
    );

    const body = await response.text();
    expect(body).toContain('href="/docs/tools/agent-send"');
    expect(body).toContain('href="/docs/cli/agent"');
    expect(body).not.toContain('/docs/docs/');
    expect(body).toContain('href="//cdn.example.com/x"');
    expect(body).toContain('href="https://builderforce.ai/pricing"');
    expect(body).toContain("href='/docs/gateway/remote'");
    expect(response.headers.get('content-length')).toBeNull();
  });

  it('streams non-HTML responses through untouched', async () => {
    const css = 'a{background:url("/x.png")} [href="/tools/x"]{}';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(css, {
      status: 200, headers: { 'content-type': 'text/css' },
    })));

    const response = await GET(
      new NextRequest('https://builderforce.ai/docs/_astro/site.css'),
      { params: Promise.resolve({ path: ['_astro', 'site.css'] }) },
    );

    expect(await response.text()).toBe(css);
  });
});
