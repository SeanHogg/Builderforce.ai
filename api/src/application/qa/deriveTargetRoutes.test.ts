/**
 * Contract tests for QA route discovery — the answer to "what do we explore when
 * nobody has used this site yet".
 *
 * The behaviour these pin is the one that made an exploration meaningless: with
 * no captured heat the tester planned a single hardcoded `/` and reported the
 * whole app healthy on the strength of its home page. Every case below is a way
 * that could silently come back — a target that 404s, one that serves JSON, one
 * that links only to assets — and the required answer is always "at least the
 * root, never a thrown error".
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { deriveTargetZones, rootZone } from './deriveTargetRoutes';

/** Stub `fetch` with a single canned response (or a rejection). */
function stubFetch(response: Partial<Response> | Error) {
  const fn = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response as Response;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function htmlResponse(html: string, status = 200): Partial<Response> {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
    arrayBuffer: async () => new TextEncoder().encode(html).buffer as ArrayBuffer,
  };
}

const PAGE = `<!doctype html><html><body>
  <a href="/">Home</a>
  <a href="/pricing">Pricing</a>
  <a href="/docs/getting-started">Docs</a>
  <a href="/login">Sign in</a>
  <a href="/logo.svg">logo</a>
  <a href="/api/health">health</a>
  <a href="https://elsewhere.example.com/other">Off-site</a>
  <a href="mailto:hi@example.com">Mail</a>
</body></html>`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('deriveTargetZones', () => {
  it('derives the pages the root links to, root first', async () => {
    stubFetch(htmlResponse(PAGE));
    const zones = await deriveTargetZones(undefined, 'https://app.example.com', 20);
    expect(zones[0]?.route).toBe('/');
    expect(zones.map((z) => z.route)).toContain('/pricing');
    expect(zones.map((z) => z.route)).toContain('/docs/getting-started');
  });

  it('drops assets, API paths, the auth surface and off-site links', async () => {
    stubFetch(htmlResponse(PAGE));
    const routes = (await deriveTargetZones(undefined, 'https://app.example.com', 20)).map((z) => z.route);
    expect(routes).not.toContain('/logo.svg');
    expect(routes).not.toContain('/api/health');
    expect(routes).not.toContain('/login');
    expect(routes.some((r) => r.includes('elsewhere.example.com'))).toBe(false);
  });

  // Discovered routes must never outrank a route real users actually used — a
  // non-zero score here would let a crawl of a quiet page beat the checkout flow.
  it('scores every derived route at zero', async () => {
    stubFetch(htmlResponse(PAGE));
    const zones = await deriveTargetZones(undefined, 'https://app.example.com', 20);
    expect(zones.every((z) => z.heat === 0 && z.score === 0)).toBe(true);
    expect(zones.every((z) => z.selector === null)).toBe(true);
  });

  it('honours the caller limit', async () => {
    stubFetch(htmlResponse(PAGE));
    const zones = await deriveTargetZones(undefined, 'https://app.example.com', 2);
    expect(zones).toHaveLength(2);
    expect(zones[0]?.route).toBe('/');
  });

  it.each([
    ['no target url at all', null],
    ['an empty target url', ''],
  ])('falls back to the root with %s', async (_label, url) => {
    const fetchSpy = stubFetch(htmlResponse(PAGE));
    expect(await deriveTargetZones(undefined, url, 20)).toEqual(rootZone());
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['a target that errors', new Error('ECONNREFUSED')],
    ['a 404', htmlResponse('nope', 404)],
    ['a non-HTML body', {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      arrayBuffer: async () => new TextEncoder().encode('{}').buffer as ArrayBuffer,
    } as Partial<Response>],
    ['a page with no links', htmlResponse('<html><body>hi</body></html>')],
  ])('degrades to the root plan on %s, without throwing', async (_label, response) => {
    stubFetch(response as Partial<Response> | Error);
    await expect(deriveTargetZones(undefined, 'https://app.example.com', 20)).resolves.toEqual(rootZone());
  });
});
