import { beforeEach, describe, expect, it, vi } from 'vitest';

const tenantHasFeature = vi.fn<(...args: unknown[]) => Promise<boolean>>();
vi.mock('../tenant/featureEntitlements', () => ({ tenantHasFeature: (...args: unknown[]) => tenantHasFeature(...args) }));

import type { Env } from '../../env';
import { SITE_BADGE_LABEL, SITE_BADGE_URL, injectBeforeBodyClose, injectSiteBadge, withSiteBadge } from './siteAttribution';

const env = {} as Env;
const html = (body: string, headers: Record<string, string> = { 'content-type': 'text/html; charset=utf-8' }) =>
  new Response(body, { status: 200, headers: { ...headers, 'content-length': String(body.length) } });

describe('injectBeforeBodyClose', () => {
  it('inserts before the LAST </body>, case-insensitively', () => {
    const out = injectBeforeBodyClose('<body><template></body></template><p>x</p></BODY>', 'm1', '<i id="m1"></i>');
    expect(out).toBe('<body><template></body></template><p>x</p><i id="m1"></i></BODY>');
  });

  it('appends to a fragment that has no </body>', () => {
    expect(injectBeforeBodyClose('<p>x</p>', 'm1', '<i id="m1"></i>')).toBe('<p>x</p><i id="m1"></i>');
  });

  it('is a no-op when the marker is already present as an id or a data-bf-marker', () => {
    const withId = '<body><i id="m1"></i></body>';
    expect(injectBeforeBodyClose(withId, 'm1', '<i id="m1"></i>')).toBe(withId);
    const withAttr = '<body><script data-bf-marker="m2"></script></body>';
    expect(injectBeforeBodyClose(withAttr, 'm2', '<script data-bf-marker="m2"></script>')).toBe(withAttr);
  });

  it('keeps two different markers independent (badge + loader on one page)', () => {
    const once = injectBeforeBodyClose(injectSiteBadge('<body></body>'), 'bf-replay-loader', '<script data-bf-marker="bf-replay-loader"></script>');
    expect(once).toContain('id="bf-made-with"');
    expect(once).toContain('data-bf-marker="bf-replay-loader"');
    expect(injectSiteBadge(once)).toBe(once);
  });
});

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
