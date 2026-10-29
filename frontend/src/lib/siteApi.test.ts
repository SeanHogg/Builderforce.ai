// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { publishSite, publishSitePreview } from './siteApi';
import { subscribeSitePublished } from './sitePublishEvents';

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
  // A workspace token: these calls are for signed-in people (see `api.test.ts`).
  localStorage.setItem('bf_tenant_token', 'test-tenant-token');
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// publishSite / publishSitePreview — ONE multipart builder, two endpoints' fields
// ---------------------------------------------------------------------------

describe('publishSite and publishSitePreview', () => {
  const assets = [{ path: 'index.html', data: new Uint8Array([60, 104]) }, { path: 'assets/app.js', data: new Uint8Array([1]) }];
  const published = { subdomain: 'shop', versionToken: 'rel-1', assetCount: 2, totalBytes: 3, url: 'https://shop.builderforce.ai', pathUrl: 'https://builderforce.ai/s/shop' };

  it('publishSite posts one part per file plus the subdomain, and announces the live site', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(published), { status: 200 }));
    const heard = vi.fn();
    const stop = subscribeSitePublished(heard);
    await publishSite(7, assets, 'shop');
    await vi.waitFor(() => expect(heard).toHaveBeenCalledWith(7, expect.objectContaining({ subdomain: 'shop' })));
    stop();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/ide\/projects\/7\/publish$/);
    const form = init.body as FormData;
    expect(form.get('subdomain')).toBe('shop');
    expect(form.has('index.html')).toBe(true);
    expect(form.has('assets/app.js')).toBe(true);
    expect(form.has('preview')).toBe(false);
  });

  it('publishSitePreview posts the same parts with preview=1 and the fix, and does NOT announce a live site', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ versionToken: 'rel-p', liveVersionToken: 'rel-1', assetCount: 2, totalBytes: 3, url: published.url, preview: true, recorded: true }), { status: 201 }));
    const heard = vi.fn();
    const stop = subscribeSitePublished(heard);
    const result = await publishSitePreview(7, assets, 'rx-9');
    await Promise.resolve();
    stop();
    expect(heard).not.toHaveBeenCalled();
    expect(result.versionToken).toBe('rel-p');
    expect(result.recorded).toBe(true);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/ide\/projects\/7\/publish$/);
    const form = init.body as FormData;
    expect(form.get('preview')).toBe('1');
    expect(form.get('prescription')).toBe('rx-9');
    expect(form.has('subdomain')).toBe(false);
    expect(form.has('index.html')).toBe(true);
  });
});
