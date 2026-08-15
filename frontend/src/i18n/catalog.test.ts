import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DEFAULT_LOCALE, LOCALES } from './config';
import { catalogUrl, defaultMessages, loadCatalog } from './catalog';

/**
 * The regression this guards is a BUILD failure, not a runtime one: when the
 * catalogs were reachable from the module graph, every Edge Runtime function
 * carried all five (~3.5 MB) and `/embedded` could not be built at all
 * ("Exceeds maximum edge function size: 4 MB / 4 MB").
 *
 * A unit test cannot weigh a bundle, so it asserts the two properties that keep
 * them out of it: the default locale is served WITHOUT a request (it is the one
 * catalog that stays bundled), and every other locale is fetched from the
 * published asset instead of imported.
 */
describe('i18n catalog loader', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('serves the default locale from the bundled catalog, with no request', async () => {
    await expect(loadCatalog(DEFAULT_LOCALE)).resolves.toBe(defaultMessages);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('versions the asset URL so a deploy invalidates cached copies', () => {
    for (const locale of LOCALES) {
      expect(catalogUrl(locale)).toMatch(new RegExp(`^/i18n/${locale}\\.json\\?v=.+$`));
    }
  });

  it('fetches a non-default catalog from the published asset and caches it', async () => {
    const messages = { greeting: 'Bonjour' };
    fetchMock.mockResolvedValue({ ok: true, json: async () => messages });

    await expect(loadCatalog('fr', 'https://example.test')).resolves.toEqual(messages);
    expect(fetchMock).toHaveBeenCalledWith(
      `https://example.test${catalogUrl('fr')}`,
      expect.objectContaining({ cache: 'force-cache' }),
    );

    // Second read is served from the in-memory cache — one request per isolate.
    await expect(loadCatalog('fr', 'https://example.test')).resolves.toEqual(messages);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('degrades to the default catalog when the asset cannot be read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockResolvedValue({ ok: false, status: 404 });

    // A page rendering in the wrong language beats a page that does not render.
    await expect(loadCatalog('de', 'https://example.test')).resolves.toBe(defaultMessages);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
