import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { invalidateClientCache } from '@/infrastructure/http/readThrough';
import { DEFAULT_LOCALE, LOCALES } from './config';
import { chunkUrl, catalogUrl, defaultMessages, loadCatalog, loadNamespace, manifestUrl } from './catalog';
import { namespacesForPath } from './routeNamespaces.generated';

/**
 * The regression this guards is a BUILD failure, not a runtime one: when the
 * catalogs were reachable from the module graph, every Edge Runtime function
 * carried all five (~3.5 MB) and `/embedded` could not be built at all
 * ("Exceeds maximum edge function size: 4 MB / 4 MB").
 *
 * A unit test cannot weigh a bundle, so it asserts the properties that keep the
 * catalogs out of it AND that chunked loading is a strict improvement, never a
 * regression:
 *
 *   - The default locale is served WITHOUT a request (bundled static import).
 *   - The SERVER always gets the FULL flat catalog — chunked loading never
 *     touches the server, so SSR / server components render every namespace
 *     exactly as before (the next-intl contract is unchanged there).
 *   - The CLIENT overlays the per-route namespace chunks onto the flat catalog,
 *     so a chunk that is missing/stale leaves the flat copy in place rather than
 *     dropping a label.
 */

const frCatalog = {
  common: { hello: 'Bonjour' },
  dashboard: { title: 'Tableau de bord' },
  promptsPage: { use: 'Utiliser' },
};

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body };
}

describe('i18n catalog loader', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    // The loader caches catalogs/chunks/manifest in the shared read-through
    // cache; without clearing it a value loaded in one test leaks into the next.
    invalidateClientCache('');
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    invalidateClientCache('');
    vi.unstubAllGlobals();
  });

  it('serves the default locale from the bundled catalog, with no request', async () => {
    await expect(loadCatalog(DEFAULT_LOCALE)).resolves.toBe(defaultMessages);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('versions every published asset URL so a deploy invalidates cached copies', () => {
    for (const locale of LOCALES) {
      expect(catalogUrl(locale)).toMatch(new RegExp(`^/i18n/${locale}\\.json\\?v=.+$`));
      expect(chunkUrl(locale, 'dashboard')).toMatch(new RegExp(`^/i18n/chunks/${locale}/dashboard\\.json\\?v=.+$`));
    }
    expect(manifestUrl()).toMatch(/^\/i18n\/manifest\.json\?v=.+$/);
  });

  it('returns the full flat catalog on the server, with no chunk fetch', async () => {
    // The suite runs in jsdom, so `window` exists unless removed — and the
    // loader's server/client split keys off exactly that.
    vi.stubGlobal('window', undefined);
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith(catalogUrl('fr'))) return jsonResponse(frCatalog);
      throw new Error(`unexpected fetch: ${url}`);
    });

    await expect(loadCatalog('fr', 'https://example.test')).resolves.toEqual(frCatalog);
    // Exactly one fetch: the flat catalog. No manifest, no chunks on the server.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `https://example.test${catalogUrl('fr')}`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('overlays per-route chunks onto the flat catalog on the client', async () => {
    // Simulate a browser so the client chunking path runs.
    vi.stubGlobal('window', { location: { pathname: '/dashboard' } });
    // The manifest lists only the namespaces this test actually serves chunks
    // for; the loader prefetches route-set ∩ manifest, so anything unlisted is
    // never fetched.
    const manifest = { fr: ['dashboard'] };
    const dashboardChunk = { dashboard: { title: 'Tableau (chunk)' } };

    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith(catalogUrl('fr'))) return jsonResponse(frCatalog);
      if (url.endsWith(manifestUrl())) return jsonResponse(manifest);
      if (url.endsWith(chunkUrl('fr', 'dashboard'))) return jsonResponse(dashboardChunk);
      throw new Error(`unexpected fetch: ${url}`);
    });

    const loaded = await loadCatalog('fr', 'https://example.test');
    // The route's namespace is the chunk copy; everything else is the flat copy.
    expect((loaded.dashboard as { title: string }).title).toBe('Tableau (chunk)');
    expect((loaded.common as { hello: string }).hello).toBe('Bonjour');
    // A namespace the route map did NOT list stays the flat copy (no fetch for it).
    expect((loaded.promptsPage as { use: string }).use).toBe('Utiliser');
  });

  it('degrades to the flat catalog when a chunk is missing on the client', async () => {
    vi.stubGlobal('window', { location: { pathname: '/dashboard' } });
    const manifest = { fr: ['dashboard'] };

    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith(catalogUrl('fr'))) return jsonResponse(frCatalog);
      if (url.endsWith(manifestUrl())) return jsonResponse(manifest);
      if (url.endsWith(chunkUrl('fr', 'dashboard'))) return { ok: false, status: 404 };
      throw new Error(`unexpected fetch: ${url}`);
    });

    // A 404 chunk leaves the flat (server-rendered) copy in place — never a missing label.
    const loaded = await loadCatalog('fr', 'https://example.test');
    expect((loaded.dashboard as { title: string }).title).toBe('Tableau de bord');
  });

  it('degrades to the default catalog when the flat asset cannot be read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockResolvedValue({ ok: false, status: 404 });

    await expect(loadCatalog('de', 'https://example.test')).resolves.toBe(defaultMessages);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('loadNamespace returns one namespace, or null when absent', async () => {
    const manifest = { fr: ['dashboard'] };
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith(manifestUrl())) return jsonResponse(manifest);
      if (url.endsWith(chunkUrl('fr', 'dashboard'))) return jsonResponse({ dashboard: frCatalog.dashboard });
      throw new Error(`unexpected fetch: ${url}`);
    });

    await expect(loadNamespace('fr', 'dashboard', 'https://example.test')).resolves.toEqual({
      dashboard: frCatalog.dashboard,
    });
    await expect(loadNamespace('fr', 'nope', 'https://example.test')).resolves.toBeNull();
  });
});

describe('route → namespace map', () => {
  it('falls back to a conservative shared set for unknown segments', () => {
    const en = defaultMessages as Record<string, unknown>;
    for (const ns of namespacesForPath('/some-route-with-no-entry')) {
      expect(en[ns]).toBeTypeOf('object');
    }
    // The catch-all covers the chrome buckets every route reads.
    expect(namespacesForPath('/no-such-segment')).toContain('common');
  });

  it('namespacesForPath returns a real, non-empty namespace list for key routes', () => {
    // Smoke test: the map resolves and returns namespaces the runtime can fetch.
    // Individual entries are validated at build time by the generator (which
    // filters to real catalog namespaces); here we only assert the contract the
    // runtime depends on — a non-empty list per route.
    for (const path of ['/dashboard', '/pricing', '/blog', '/settings', '/agents', '/']) {
      expect(namespacesForPath(path).length).toBeGreaterThan(0);
    }
  });
});
