/**
 * The one rule that decides whether an address is serving.
 *
 * Worth pinning at this level because TWO callers with opposite consequences share
 * it: the monitor sweep opens an incident, and Stage refuses to put a product on
 * sale. A drift here either pages an engineer over a healthy service or sells a
 * subscription to a dead one.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { httpCheck } from './httpCheck';

const respond = (init: { status?: number; body?: string; ok?: boolean }) => ({
  status: init.status ?? 200,
  ok: init.ok ?? (init.status ?? 200) < 300,
  text: () => Promise.resolve(init.body ?? ''),
});

const stubFetch = (impl: (url: string, init?: RequestInit) => unknown) => {
  vi.stubGlobal('fetch', vi.fn((url: unknown, init?: unknown) =>
    Promise.resolve(impl(String(url), init as RequestInit))));
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('httpCheck', () => {
  it('answers `unknown` — not `breach` — when there is nothing to ask', async () => {
    // "We have no target" and "the target is down" call for opposite responses:
    // a configuration gap versus an incident. A check with no url must never
    // read as an outage.
    stubFetch(() => respond({}));
    await expect(httpCheck({})).resolves.toBe('unknown');
    await expect(httpCheck({ url: '' })).resolves.toBe('unknown');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('accepts any 2xx by default and refuses everything else', async () => {
    stubFetch(() => respond({ status: 204 }));
    await expect(httpCheck({ url: 'https://x.test/' })).resolves.toBe('ok');
    stubFetch(() => respond({ status: 503 }));
    await expect(httpCheck({ url: 'https://x.test/' })).resolves.toBe('breach');
  });

  it('honours an exact expected status when one is declared', async () => {
    stubFetch(() => respond({ status: 200 }));
    await expect(httpCheck({ url: 'https://x.test/', expectedStatus: 301 })).resolves.toBe('breach');
    stubFetch(() => respond({ status: 301, ok: false }));
    await expect(httpCheck({ url: 'https://x.test/', expectedStatus: 301 })).resolves.toBe('ok');
  });

  it('BREACHES a 200 that does not carry the marker', async () => {
    // The reason the assertion is not a status code: a deleted function still
    // answers 200 from an edge, and a load balancer in front of a dead revision
    // is itself perfectly healthy. Only a marker the watched thing emits proves
    // the watched thing ran.
    stubFetch(() => respond({ status: 200, body: '<html>not found</html>' }));
    await expect(httpCheck({ url: 'https://x.test/health', bodyMatch: '"ok":true' }))
      .resolves.toBe('breach');
    stubFetch(() => respond({ status: 200, body: '{"ok":true,"build":"7"}' }));
    await expect(httpCheck({ url: 'https://x.test/health', bodyMatch: '"ok":true' }))
      .resolves.toBe('ok');
  });

  it('treats a blank bodyMatch as no assertion at all', async () => {
    stubFetch(() => respond({ status: 200, body: 'anything' }));
    await expect(httpCheck({ url: 'https://x.test/', bodyMatch: '   ' })).resolves.toBe('ok');
  });

  it('reads an unreachable host as a breach and NEVER throws', async () => {
    // A sweep that threw on the first dead host would stop checking the rest of
    // them — which is the population most likely to be dead.
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('getaddrinfo ENOTFOUND'))));
    await expect(httpCheck({ url: 'https://gone.test/' })).resolves.toBe('breach');
  });

  it('survives a body that cannot be read', async () => {
    stubFetch(() => ({ status: 200, ok: true, text: () => Promise.reject(new Error('aborted')) }));
    await expect(httpCheck({ url: 'https://x.test/', bodyMatch: 'marker' })).resolves.toBe('breach');
  });

  it('passes the method and headers through, and follows redirects', async () => {
    const seen: Array<[string, RequestInit | undefined]> = [];
    stubFetch((url, init) => {
      seen.push([url, init]);
      return respond({});
    });
    await httpCheck({ url: 'https://x.test/', method: 'head', headers: { 'X-Key': 'v' } });
    expect(seen[0]?.[0]).toBe('https://x.test/');
    expect(seen[0]?.[1]).toMatchObject({ method: 'HEAD', redirect: 'follow', headers: { 'X-Key': 'v' } });
  });

  it('omits an empty header bag rather than sending one', async () => {
    const seen: Array<RequestInit | undefined> = [];
    stubFetch((_url, init) => {
      seen.push(init);
      return respond({});
    });
    await httpCheck({ url: 'https://x.test/', headers: {} });
    expect(seen[0] && 'headers' in seen[0]).toBe(false);
  });
});
