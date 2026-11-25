import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The EDGE server build does not bundle the default catalog: `next.config.js`
 * aliases `./messages/en.json` to `./unbundledCatalog` (an `undefined` default), and
 * the root layout primes the catalog from its published asset before rendering.
 * This reproduces that build: the JSON import resolves to nothing, and every
 * default-locale read must come from the one primed copy.
 */
vi.mock('./messages/en.json', () => ({ default: undefined }));

const published = { common: { hello: 'Hello' } };

describe('i18n catalog on the edge server (no bundled default)', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    delete (globalThis as Record<symbol, unknown>)[Symbol.for('builderforce.i18n.defaultCatalog')];
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('refuses a synchronous read until the catalog is primed', async () => {
    const { defaultCatalog, defaultMessages } = await import('./catalog');
    expect(defaultMessages).toBeUndefined();
    expect(() => defaultCatalog()).toThrow(/primeDefaultCatalog/);
  });

  it('reads the published default catalog once, then serves every reader from it', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => published });
    const { catalogUrl, defaultCatalog, loadCatalog, primeDefaultCatalog } = await import('./catalog');

    const [a, b] = await Promise.all([primeDefaultCatalog('https://example.test'), primeDefaultCatalog('https://example.test')]);
    expect(a).toEqual(published);
    expect(b).toBe(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe(`https://example.test${catalogUrl('en')}`);

    expect(defaultCatalog()).toBe(a);
    await expect(loadCatalog('en')).resolves.toBe(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shares the primed copy with a second instance of the module (the SSR layer)', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => published });
    const rsc = await import('./catalog');
    const primed = await rsc.primeDefaultCatalog('https://example.test');

    vi.resetModules();
    const ssr = await import('./catalog');
    expect(ssr).not.toBe(rsc);
    expect(ssr.defaultCatalog()).toBe(primed);
  });

  it('does not cache a failed read: the next prime retries', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => published });
    const { primeDefaultCatalog } = await import('./catalog');

    await expect(primeDefaultCatalog('https://example.test')).rejects.toThrow(/503/);
    await expect(primeDefaultCatalog('https://example.test')).resolves.toEqual(published);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
