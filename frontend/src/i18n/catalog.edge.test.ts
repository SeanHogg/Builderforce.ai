import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The EDGE server build does not bundle the default catalog: `next.config.js`
 * aliases `./messages/en.json` to `./unbundledCatalog` (an `undefined` default), and
 * the root layout primes the catalog from its published asset before rendering.
 * This reproduces that build: the JSON import resolves to nothing, and every
 * default-locale read must come from the one primed copy.
 */
vi.mock('./messages/en.json', () => ({ default: undefined }));

const reportMock = vi.hoisted(() => vi.fn(async () => true));
vi.mock('@/lib/reportError', () => ({ reportBackgroundFailure: reportMock }));
vi.mock('./requestOrigin', () => ({ requestOrigin: async () => 'https://example.test' }));

const published = { common: { hello: 'Hello' } };
const down = { ok: false, status: 503, json: async () => ({}) };
const up = { ok: true, json: async () => published };
const SLOT = Symbol.for('builderforce.i18n.defaultCatalog');

describe('i18n catalog on the edge server (no bundled default)', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    delete (globalThis as Record<symbol, unknown>)[SLOT];
    fetchMock.mockReset();
    reportMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    delete (globalThis as Record<symbol, unknown>)[SLOT];
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

  it('retries a failed read once before giving up', async () => {
    fetchMock.mockResolvedValueOnce(down).mockResolvedValueOnce(up);
    const { primeDefaultCatalog } = await import('./catalog');

    await expect(primeDefaultCatalog('https://example.test')).resolves.toEqual(published);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(reportMock).not.toHaveBeenCalled();
  });

  it('reports a read that fails twice, rejects, and does not cache the failure', async () => {
    fetchMock.mockResolvedValueOnce(down).mockResolvedValueOnce(down).mockResolvedValueOnce(up);
    const { primeDefaultCatalog } = await import('./catalog');

    await expect(primeDefaultCatalog('https://example.test')).rejects.toThrow(/503/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(reportMock).toHaveBeenCalledTimes(1);
    expect(reportMock).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/503/) }));

    await expect(primeDefaultCatalog('https://example.test')).resolves.toEqual(published);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('lets a waiter on a failed shared read make one read of its own', async () => {
    fetchMock.mockResolvedValueOnce(down).mockResolvedValueOnce(down).mockResolvedValue(up);
    const { primeDefaultCatalog } = await import('./catalog');

    const owner = primeDefaultCatalog('https://example.test');
    const waiter = primeDefaultCatalog('https://example.test');
    const another = primeDefaultCatalog('https://example.test');
    await expect(owner).rejects.toThrow(/503/);
    const [a, b] = await Promise.all([waiter, another]);
    expect(a).toEqual(published);
    expect(b).toBe(a);
    // owner: two attempts; both waiters share ONE fresh load.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await expect(primeDefaultCatalog('https://example.test')).resolves.toBe(a);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('defaultCopy refuses to read before the prime, then answers from the primed catalog', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'edge');
    fetchMock.mockResolvedValue({ ok: true, json: async () => published });
    const { defaultCopy, serverDefaultCopy } = await import('@/lib/content/defaultCopy');

    expect(() => defaultCopy('common.hello')).toThrow(/primeDefaultCatalog/);
    const copy = await serverDefaultCopy();
    expect(copy).toBe(defaultCopy);
    expect(defaultCopy('common.hello')).toBe('Hello');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
