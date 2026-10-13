/**
 * A signed preview of a hosted release (PRD 33 §5.1.4, D13): the API grants a short-
 * lived token; the sites Worker serves THAT release to whoever carries it — privately,
 * never cached publicly, never counted as traffic or an A/B exposure, never recorded —
 * and serves the live release to everyone else.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  countSplit: vi.fn(async () => null),
  recordExposure: vi.fn(async () => {}),
  withReplayLoader: vi.fn(async (_e: unknown, _t: number, _p: number, _v: string, res: Response) => res),
}));

vi.mock('./siteAbSplit', () => ({
  resolveSiteSplit: mocks.countSplit,
  recordSplitExposure: mocks.recordExposure,
  withSplitCookie: (r: Response) => r,
}));
vi.mock('./siteAttribution', () => ({ withSiteBadge: async (_e: unknown, _t: number, res: Response) => res }));
vi.mock('./siteReplayInjection', () => ({ withReplayLoader: mocks.withReplayLoader }));
vi.mock('./siteTraffic', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./siteTraffic')>()),
  sharedTrafficBuffer: () => ({ record: () => false, drain: () => [] }),
}));

import {
  grantSitePreview,
  resolveSitePreview,
  SITE_PREVIEW_TTL_SECONDS,
  sitePreviewKey,
  withPreviewHeaders,
} from './sitePreviewAccess';
import { serveCountedAsset } from './siteStaticServe';

const SITE = {
  siteId: 1, projectId: 42, tenantId: 7, r2Prefix: 'sites/shop/live/', status: 'active', versionToken: 'live', indexDocument: 'index.html', landingObjectId: null,
};
const NOW = new Date('2026-10-13T12:00:00.000Z');

function kv() {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    put: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
  };
}

function uploads(files: Record<string, string>) {
  return {
    get: vi.fn(async (key: string) => (key in files ? { body: new Response(files[key]).body, size: files[key]!.length, text: async () => files[key] } : null)),
  };
}

let env: { AUTH_CACHE_KV: ReturnType<typeof kv>; UPLOADS: ReturnType<typeof uploads> };

beforeEach(() => {
  env = {
    AUTH_CACHE_KV: kv(),
    UPLOADS: uploads({ 'sites/shop/live/index.html': 'LIVE', 'sites/shop/prev/index.html': 'PREVIEW' }),
  };
  mocks.countSplit.mockClear();
  mocks.recordExposure.mockClear();
  mocks.withReplayLoader.mockClear();
});

async function grant(over: Record<string, unknown> = {}, now: Date = NOW) {
  const out = await grantSitePreview(env as never, { tenantId: 7, projectId: 42, versionToken: 'prev', r2Prefix: 'sites/shop/prev/', ...over } as never, now);
  return out!.token;
}

describe('grantSitePreview', () => {
  it('stores a short-lived grant naming one tenant, project and release', async () => {
    const token = await grant();
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect(env.AUTH_CACHE_KV.put).toHaveBeenCalledWith(sitePreviewKey(token), expect.any(String), { expirationTtl: SITE_PREVIEW_TTL_SECONDS });
    expect(JSON.parse(env.AUTH_CACHE_KV.store.get(sitePreviewKey(token))!)).toMatchObject({ tenantId: 7, projectId: 42, versionToken: 'prev' });
  });
});

describe('resolveSitePreview', () => {
  it('serves the previewed release from the query string or the cookie', async () => {
    const token = await grant();
    const fromQuery = await resolveSitePreview(env as never, SITE, new Request(`https://shop.builderforce.ai/?bf_preview=${token}`), NOW.getTime());
    expect(fromQuery).toMatchObject({ fromQuery: true, served: { r2Prefix: 'sites/shop/prev/', versionToken: 'prev' } });
    const fromCookie = await resolveSitePreview(env as never, SITE, new Request('https://shop.builderforce.ai/app.js', { headers: { cookie: `bf_preview=${token}` } }), NOW.getTime());
    expect(fromCookie).toMatchObject({ fromQuery: false });
  });

  it('refuses another site’s grant, an expired one, a malformed token — and costs no lookup without one', async () => {
    const other = await grant({ projectId: 43 });
    expect(await resolveSitePreview(env as never, SITE, new Request(`https://shop.builderforce.ai/?bf_preview=${other}`), NOW.getTime())).toBeNull();
    const token = await grant();
    const later = NOW.getTime() + (SITE_PREVIEW_TTL_SECONDS + 1) * 1000;
    expect(await resolveSitePreview(env as never, SITE, new Request(`https://shop.builderforce.ai/?bf_preview=${token}`), later)).toBeNull();
    expect(await resolveSitePreview(env as never, SITE, new Request('https://shop.builderforce.ai/?bf_preview=../../x'), NOW.getTime())).toBeNull();
    env.AUTH_CACHE_KV.get.mockClear();
    expect(await resolveSitePreview(env as never, SITE, new Request('https://shop.builderforce.ai/'), NOW.getTime())).toBeNull();
    expect(env.AUTH_CACHE_KV.get).not.toHaveBeenCalled();
  });

  it('answers privately, never cached or indexed, setting the cookie on the first hit only', async () => {
    const res = withPreviewHeaders(new Response('x', { headers: { 'Cache-Control': 'public, max-age=60' } }), {
      token: 'a'.repeat(32), served: SITE, fromQuery: true, maxAgeSeconds: 100,
    });
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('x-robots-tag')).toContain('noindex');
    expect(res.headers.get('set-cookie')).toContain('bf_preview=');
    expect(res.headers.get('set-cookie')).toContain('HttpOnly');
  });
});

describe('the sites Worker honours it', () => {
  it('serves the preview release to its holder, without counting, splitting or recording', async () => {
    const token = await grant({}, new Date());
    const waitUntil = vi.fn();
    const res = await serveCountedAsset(env as never, SITE, new Request(`https://shop.builderforce.ai/?bf_preview=${token}`), '/', waitUntil);
    expect(await res.text()).toBe('PREVIEW');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.countSplit).not.toHaveBeenCalled();
    expect(mocks.recordExposure).not.toHaveBeenCalled();
    expect(mocks.withReplayLoader).not.toHaveBeenCalled();
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it('serves the live release to everyone else', async () => {
    const res = await serveCountedAsset(env as never, SITE, new Request('https://shop.builderforce.ai/'), '/', vi.fn());
    expect(await res.text()).toBe('LIVE');
    expect(mocks.countSplit).toHaveBeenCalled();
  });
});
