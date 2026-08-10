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
