import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

describe('offline service worker', () => {
  it('serves the offline page dependencies from the shell cache', async () => {
    const listeners = new Map<string, (event: any) => void>();
    const precachedUrls: string[] = [];
    const iconResponse = { source: 'shell-cache' };
    const fetchFromNetwork = vi.fn(() => Promise.reject(new Error('offline')));

    const caches = {
      open: vi.fn(async (name: string) => ({
        addAll: async (urls: string[]) => {
          if (name.startsWith('bf-shell-')) precachedUrls.push(...urls);
        },
        match: async () => undefined,
        put: vi.fn(),
      })),
      match: vi.fn(async (request: { url?: string } | string, options?: { cacheName?: string }) => {
        const path = typeof request === 'string' ? request : new URL(request.url!).pathname;
        return options?.cacheName?.startsWith('bf-shell-') && path === '/icon-192.png'
          ? iconResponse
          : undefined;
      }),
      keys: vi.fn(async () => []),
      delete: vi.fn(),
    };

    const source = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8');
    runInNewContext(source, {
      URL,
      Response,
      caches,
      fetch: fetchFromNetwork,
      self: {
        location: { origin: 'https://builderforce.ai' },
        clients: { claim: vi.fn() },
        skipWaiting: vi.fn(),
        addEventListener: (type: string, listener: (event: any) => void) => listeners.set(type, listener),
      },
    });

    let installation!: Promise<unknown>;
    listeners.get('install')!({ waitUntil: (promise: Promise<unknown>) => { installation = promise; } });
    await installation;
    expect(precachedUrls).toEqual(expect.arrayContaining(['/offline.html', '/offline.js', '/icon-192.png']));

    let response!: Promise<unknown>;
    listeners.get('fetch')!({
      request: {
        method: 'GET',
        mode: 'no-cors',
        url: 'https://builderforce.ai/icon-192.png',
      },
      respondWith: (promise: Promise<unknown>) => { response = promise; },
    });

    await expect(response).resolves.toBe(iconResponse);
    expect(fetchFromNetwork).not.toHaveBeenCalled();
  });
});

describe('offline service worker: offline-capable routes', () => {
  /** A fresh SW with in-memory caches and a switchable network. */
  function boot() {
    const listeners = new Map<string, (event: any) => void>();
    const stores = new Map<string, Map<string, Response>>();
    const keyOf = (r: { url: string } | string) => (typeof r === 'string' ? new URL(r, 'https://builderforce.ai').href : r.url);
    const store = (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      return stores.get(name)!;
    };
    const caches = {
      open: async (name: string) => ({
        match: async (r: any) => store(name).get(keyOf(r)),
        put: async (r: any, res: Response) => { store(name).set(keyOf(r), res); },
        addAll: async () => {},
      }),
      match: async (r: any, o?: { cacheName?: string }) =>
        o?.cacheName ? store(o.cacheName).get(keyOf(r)) : undefined,
      keys: async () => [...stores.keys()],
      delete: async (k: string) => stores.delete(k),
    };
    let online = true;
    const network = vi.fn(async (req: { url: string }) => {
      if (!online) throw new TypeError('Failed to fetch');
      return new Response(`html:${req.url}`, { status: 200, headers: { 'Cross-Origin-Opener-Policy': 'same-origin' } });
    });
    const source = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8');
    runInNewContext(source, {
      URL, Response, caches, fetch: network,
      self: {
        location: { origin: 'https://builderforce.ai' },
        clients: { claim: vi.fn() },
        skipWaiting: vi.fn(),
        addEventListener: (t: string, l: (event: any) => void) => listeners.set(t, l),
      },
    });
    const request = (path: string, init: { navigate?: boolean; rsc?: boolean } = {}) => ({
      method: 'GET',
      mode: init.navigate ? 'navigate' : 'cors',
      url: `https://builderforce.ai${path}`,
      headers: { get: (n: string) => (init.rsc && n === 'RSC' ? '1' : null) },
    });
    const dispatch = (req: any): Promise<Response> | undefined => {
      let out: Promise<Response> | undefined;
      listeners.get('fetch')!({ request: req, respondWith: (p: Promise<Response>) => { out = p; } });
      return out;
    };
    return { stores, dispatch, request, setOnline: (v: boolean) => { online = v; } };
  }

  it('serves a visited /studio page from cache offline, headers intact', async () => {
    const sw = boot();
    await sw.dispatch(sw.request('/studio/abc', { navigate: true }));
    sw.setOnline(false);
    const res = await sw.dispatch(sw.request('/studio/abc', { navigate: true }))!;
    expect(await res.text()).toBe('html:https://builderforce.ai/studio/abc');
    expect(res.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
  });

  it('falls back to /offline.html for an unvisited /studio page', async () => {
    const sw = boot();
    sw.setOnline(false);
    const res = await sw.dispatch(sw.request('/studio/never', { navigate: true }))!;
    expect(res.status).toBe(503);
  });

  it('caches RSC payloads per URL and fails the fetch on a miss', async () => {
    const sw = boot();
    await sw.dispatch(sw.request('/studio?_rsc=x', { rsc: true }));
    sw.setOnline(false);
    const hit = await sw.dispatch(sw.request('/studio?_rsc=x', { rsc: true }))!;
    expect(await hit.text()).toContain('/studio?_rsc=x');
    const miss = await sw.dispatch(sw.request('/studio/y?_rsc=z', { rsc: true }))!;
    expect(miss.type).toBe('error');
  });

  it('leaves other routes and /api untouched', () => {
    const sw = boot();
    expect(sw.dispatch(sw.request('/api/templates'))).toBeUndefined();
    sw.setOnline(false);
    expect(sw.stores.size).toBe(0);
  });
});
