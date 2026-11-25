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
        add: async () => {},
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
      Request,
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
        add: async (path: string) => {
          if (failShellPrecache) throw new TypeError('shell fetch failed');
          store(name).set(keyOf(path), new Response('shell'));
        },
      }),
      match: async (r: any, o?: { cacheName?: string }) =>
        o?.cacheName ? store(o.cacheName).get(keyOf(r)) : undefined,
      keys: async () => [...stores.keys()],
      delete: async (k: string) => stores.delete(k),
    };
    let online = true;
    let failShellPrecache = false;
    let serverStatus = 200;
    const network = vi.fn(async (req: { url: string }) => {
      if (!online) throw new TypeError('Failed to fetch');
      if (serverStatus !== 200) return new Response('down', { status: serverStatus });
      return new Response(`html:${req.url}`, { status: 200, headers: { 'Cross-Origin-Opener-Policy': 'same-origin' } });
    });
    const source = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8');
    runInNewContext(source, {
      URL, Request, Response, caches, fetch: network,
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
    const install = async () => {
      let installation: Promise<unknown> = Promise.resolve();
      listeners.get('install')!({ waitUntil: (p: Promise<unknown>) => { installation = p; } });
      await installation;
    };
    return {
      stores, dispatch, request, install,
      setOnline: (v: boolean) => { online = v; },
      failShell: () => { failShellPrecache = true; },
      setServerStatus: (v: number) => { serverStatus = v; },
    };
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

  describe('device-board shell', () => {
    const BOARD = '0f8fad5b-d9cb-469f-a165-70867728950e';

    it('precaches the shell on install, and a failed shell fetch does not fail the install', async () => {
      const ok = boot();
      await ok.install();
      expect([...ok.stores.entries()].some(([name, entries]) => name.startsWith('bf-pages-') && entries.has('https://builderforce.ai/studio/local'))).toBe(true);
      const failing = boot();
      failing.failShell();
      await expect(failing.install()).resolves.toBeUndefined();
    });

    it('redirects an offline, never-visited /studio/<uuid> to the shell with the board id', async () => {
      const sw = boot();
      await sw.install();
      sw.setOnline(false);
      const res = await sw.dispatch(sw.request(`/studio/${BOARD}`, { navigate: true }))!;
      expect(res.status).toBe(302);
      expect(res.headers.get('Location')).toBe(`https://builderforce.ai/studio/local?board=${BOARD}`);
    });

    it('falls back to the offline page when the shell was never cached', async () => {
      const sw = boot();
      sw.setOnline(false);
      const res = await sw.dispatch(sw.request(`/studio/${BOARD}`, { navigate: true }))!;
      expect(res.status).toBe(503);
    });

    it('redirects an unvisited board during a server outage, but passes the 5xx through without a shell', async () => {
      const withShell = boot();
      await withShell.install();
      withShell.setServerStatus(503);
      const redirected = await withShell.dispatch(withShell.request(`/studio/${BOARD}`, { navigate: true }))!;
      expect(redirected.status).toBe(302);
      const bare = boot();
      bare.setServerStatus(503);
      const passed = await bare.dispatch(bare.request(`/studio/${BOARD}`, { navigate: true }))!;
      expect(passed.status).toBe(503);
      expect(await passed.text()).toBe('down');
    });

    it('never redirects a non-board /studio path', async () => {
      const sw = boot();
      await sw.install();
      sw.setOnline(false);
      for (const path of ['/studio/project/x', `/studio/${BOARD}/extra`, '/studio/not-a-uuid']) {
        const res = await sw.dispatch(sw.request(path, { navigate: true }))!;
        expect(res.status).toBe(503);
      }
    });

    it('serves every /studio/local?board=<id> from the one bare-path entry', async () => {
      const sw = boot();
      await sw.install();
      sw.setOnline(false);
      const res = await sw.dispatch(sw.request(`/studio/local?board=${BOARD}`, { navigate: true }))!;
      expect(await res.text()).toBe('shell');
    });
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
