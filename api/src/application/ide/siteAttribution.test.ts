import { beforeEach, describe, expect, it, vi } from 'vitest';

const tenantHasFeature = vi.fn<(...args: unknown[]) => Promise<boolean>>();
vi.mock('../tenant/featureEntitlements', () => ({ tenantHasFeature: (...args: unknown[]) => tenantHasFeature(...args) }));

import type { Env } from '../../env';
import { SITE_BADGE_LABEL, SITE_BADGE_URL, injectSiteBadge, withSiteBadge } from './siteAttribution';

const env = {} as Env;
const html = (body: string, headers: Record<string, string> = { 'content-type': 'text/html; charset=utf-8' }) =>
  new Response(body, { status: 200, headers: { ...headers, 'content-length': String(body.length) } });

describe('injectSiteBadge', () => {
  it('puts a plain, crawlable backlink before the last </body>', () => {
    const out = injectSiteBadge('<html><body><p>app</p></body></html>');
    expect(out).toContain(`href="${SITE_BADGE_URL}"`);
    expect(out).toContain(`>${SITE_BADGE_LABEL}</a></body>`);
    expect(out).not.toContain('<script');
    expect(out).not.toContain('nofollow');
  });

  it('is idempotent and handles fragments', () => {
    const once = injectSiteBadge('<body></body>');
    expect(injectSiteBadge(once)).toBe(once);
    expect(injectSiteBadge('<p>x</p>').startsWith('<p>x</p><a id="bf-made-with"')).toBe(true);
  });

  it('carries the UTM tags that attribute the visit', () => {
    expect(SITE_BADGE_URL).toMatch(/^https:\/\/builderforce\.ai\/\?utm_source=published-site&utm_medium=badge/);
  });
});

describe('withSiteBadge', () => {
  beforeEach(() => tenantHasFeature.mockReset());

  it('badges a free tenant\'s HTML document and drops the stale content-length', async () => {
    tenantHasFeature.mockResolvedValue(false);
    const res = await withSiteBadge(env, 7, html('<html><body>hi</body></html>'));
    expect(await res.text()).toContain('bf-made-with');
    expect(res.headers.get('content-length')).toBeNull();
    expect(tenantHasFeature).toHaveBeenCalledWith(env, 7, undefined, 'removeBranding');
  });

  it('leaves a paying tenant\'s document byte-for-byte', async () => {
    tenantHasFeature.mockResolvedValue(true);
    const res = await withSiteBadge(env, 7, html('<html><body>hi</body></html>'));
    expect(await res.text()).toBe('<html><body>hi</body></html>');
  });

  it('never reads the plan for assets', async () => {
    const res = await withSiteBadge(env, 7, html('body{}', { 'content-type': 'text/css' }));
    expect(await res.text()).toBe('body{}');
    expect(tenantHasFeature).not.toHaveBeenCalled();
  });

  it('keeps the status of a badged 404 page', async () => {
    tenantHasFeature.mockResolvedValue(false);
    const res = await withSiteBadge(env, 7, new Response('<body>gone</body>', { status: 404, headers: { 'content-type': 'text/html' } }));
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('bf-made-with');
  });
});
