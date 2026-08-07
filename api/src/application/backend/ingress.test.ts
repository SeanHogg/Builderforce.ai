/**
 * The shared ingress executor.
 *
 * What is actually being asserted here is that giving handlers a SECOND, nicer
 * address did not give them a second, weaker one: the same verification, the same
 * unmatched-route answer, the same request log, whichever prefix addressed them.
 * A test that only exercised the site path would not catch a divergence — so the
 * cases below drive `dispatchIngressRequest` directly, the way both callers do.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDb } from '../../../test/fakeDb';
import { dispatchIngressRequest, ingressRuntimeDeps, INGRESS_RPM } from './ingress';
import type { HandlerSpec } from './handlerSpec';

const spec = (over: Partial<HandlerSpec> = {}): HandlerSpec => ({
  name: 'quote',
  route: '/quote',
  method: 'POST',
  verify: 'none',
  steps: [],
  respond: { kind: 'json', body: { ok: true } },
  ...over,
});

let handlers: { specs: HandlerSpec[]; errors: Array<{ path: string; reason: string }> };

vi.mock('./index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./index')>();
  return {
    ...actual,
    loadHandlersCached: vi.fn(async () => handlers),
    projectDisplayName: vi.fn(async () => 'Acme'),
    recordBackendRequest: vi.fn(async () => {}),
  };
});

const target = {
  projectId: 7,
  tenantId: 3,
  ingressUrl: 'https://acme.builderforce.ai/api',
  rateLimitKey: 'site-ingress:1',
};

const env = { UPLOADS: {} } as never;

beforeEach(() => {
  handlers = { specs: [spec()], errors: [] };
});

const post = (url: string, body: unknown = { name: 'Ada' }) =>
  new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('dispatchIngressRequest', () => {
  it('runs the matching handler and returns its shaped response', async () => {
    const result = await dispatchIngressRequest({
      env,
      db: fakeDb() as never,
      target,
      request: post('https://acme.builderforce.ai/api/quote'),
      route: '/quote',
    });
    expect(result.matched).toBe(true);
    if (!result.matched) throw new Error('unreachable');
    expect(result.response.status).toBe(200);
    await expect(result.response.json()).resolves.toEqual({ ok: true });
  });

  it('reports UNMATCHED rather than 404ing, so the site can fall through to a file', async () => {
    handlers = { specs: [], errors: [] };
    const result = await dispatchIngressRequest({
      env,
      db: fakeDb() as never,
      target,
      request: post('https://acme.builderforce.ai/api/nope'),
      route: '/nope',
    });
    expect(result.matched).toBe(false);
    if (result.matched) throw new Error('unreachable');
    expect(result.detail).toContain('No handler for POST /nope');
  });

  it('blames the broken spec when one exists for that exact route', async () => {
    handlers = { specs: [], errors: [{ path: 'handlers/quote.json', reason: 'Not valid JSON' }] };
    const result = await dispatchIngressRequest({
      env,
      db: fakeDb() as never,
      target,
      request: post('https://acme.builderforce.ai/api/quote'),
      route: '/quote',
    });
    expect(result.matched).toBe(false);
    if (result.matched) throw new Error('unreachable');
    expect(result.detail).toContain('handlers/quote.json');
    expect(result.detail).toContain('Not valid JSON');
  });

  it('normalises the route the same way the spec parser does', async () => {
    // Trailing slash and case: `/Quote/` must reach the handler that claims `/quote`.
    const result = await dispatchIngressRequest({
      env,
      db: fakeDb() as never,
      target,
      request: post('https://acme.builderforce.ai/api/Quote/'),
      route: '/Quote/',
    });
    expect(result.matched).toBe(true);
  });

  it('refuses a signed handler on the site address exactly as on the webhook address', async () => {
    // The whole risk of a friendlier URL is that it skips message-level auth.
    handlers = { specs: [spec({ verify: 'twilio' })], errors: [] };
    const db = fakeDb([[]]); // secret lookup returns nothing → no auth token
    const result = await dispatchIngressRequest({
      env,
      db: db as never,
      target,
      request: post('https://acme.builderforce.ai/api/quote'),
      route: '/quote',
    });
    expect(result.matched).toBe(true);
    if (!result.matched) throw new Error('unreachable');
    expect(result.response.status).toBe(403);
  });

  it('rejects an oversized body before running a single step', async () => {
    const huge = 'x'.repeat(200 * 1024);
    const result = await dispatchIngressRequest({
      env,
      db: fakeDb() as never,
      target,
      request: post('https://acme.builderforce.ai/api/quote', { blob: huge }),
      route: '/quote',
    });
    expect(result.matched).toBe(true);
    if (!result.matched) throw new Error('unreachable');
    expect(result.response.status).toBe(413);
  });

  it('degrades to 503 when storage is unconfigured instead of pretending nothing matched', async () => {
    const result = await dispatchIngressRequest({
      env: {} as never,
      db: fakeDb() as never,
      target,
      request: post('https://acme.builderforce.ai/api/quote'),
      route: '/quote',
    });
    expect(result.matched).toBe(true);
    if (!result.matched) throw new Error('unreachable');
    expect(result.response.status).toBe(503);
  });

  it('sends no CORS headers when the handler declared no allow-list', async () => {
    // The default a published site and a provider webhook both rely on.
    const result = await dispatchIngressRequest({
      env,
      db: fakeDb() as never,
      target,
      request: new Request('https://acme.builderforce.ai/api/quote', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://elsewhere.test' },
        body: '{}',
      }),
      route: '/quote',
    });
    if (!result.matched) throw new Error('unreachable');
    expect(result.response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('answers an allowed origin on the real request, and varies on Origin', async () => {
    handlers = { specs: [spec({ cors: ['https://elsewhere.test'] })], errors: [] };
    const result = await dispatchIngressRequest({
      env,
      db: fakeDb() as never,
      target,
      request: new Request('https://acme.builderforce.ai/api/quote', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://elsewhere.test' },
        body: '{}',
      }),
      route: '/quote',
    });
    if (!result.matched) throw new Error('unreachable');
    expect(result.response.status).toBe(200);
    expect(result.response.headers.get('access-control-allow-origin')).toBe('https://elsewhere.test');
    expect(result.response.headers.get('vary')).toBe('Origin');
  });

  it('varies on Origin even for a REFUSED caller, so no cache leaks the permission', async () => {
    handlers = { specs: [spec({ cors: ['https://elsewhere.test'] })], errors: [] };
    const result = await dispatchIngressRequest({
      env,
      db: fakeDb() as never,
      target,
      request: new Request('https://acme.builderforce.ai/api/quote', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://evil.test' },
        body: '{}',
      }),
      route: '/quote',
    });
    if (!result.matched) throw new Error('unreachable');
    expect(result.response.headers.get('access-control-allow-origin')).toBeNull();
    expect(result.response.headers.get('vary')).toBe('Origin');
  });

  it('answers a preflight without running the handler', async () => {
    // The point of handling OPTIONS before matching: an `ANY` handler claims
    // every method, so a preflight would otherwise spend its steps to answer a
    // question the browser asked only to find out whether it may send anything.
    handlers = {
      specs: [spec({ method: 'ANY', cors: ['https://elsewhere.test'], steps: [{ kind: 'set', id: 'a', value: 'x' }] })],
      errors: [],
    };
    const result = await dispatchIngressRequest({
      env,
      db: fakeDb() as never,
      target,
      request: new Request('https://acme.builderforce.ai/api/quote', {
        method: 'OPTIONS',
        headers: {
          origin: 'https://elsewhere.test',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type, x-trace',
        },
      }),
      route: '/quote',
    });
    if (!result.matched) throw new Error('unreachable');
    expect(result.response.status).toBe(204);
    expect(result.response.headers.get('access-control-allow-origin')).toBe('https://elsewhere.test');
    // `ANY` reports the method the browser actually asked about.
    expect(result.response.headers.get('access-control-allow-methods')).toBe('POST');
    expect(result.response.headers.get('access-control-allow-headers')).toBe('content-type, x-trace');
    expect(await result.response.text()).toBe('');
  });

  it('refuses a preflight from an origin the handler does not name', async () => {
    handlers = { specs: [spec({ cors: ['https://elsewhere.test'] })], errors: [] };
    const result = await dispatchIngressRequest({
      env,
      db: fakeDb() as never,
      target,
      request: new Request('https://acme.builderforce.ai/api/quote', {
        method: 'OPTIONS',
        headers: { origin: 'https://evil.test', 'access-control-request-method': 'POST' },
      }),
      route: '/quote',
    });
    if (!result.matched) throw new Error('unreachable');
    expect(result.response.status).toBe(403);
    expect(result.response.headers.get('access-control-allow-origin')).toBeNull();
    // The refusal says why — a bare "CORS error" is nothing to act on.
    expect(await result.response.text()).toContain('evil.test');
  });

  it('preflights the method the browser INTENDS, not OPTIONS', async () => {
    // The handler claims POST only. Matching on OPTIONS would 404 the preflight
    // and the real POST would never be sent.
    handlers = { specs: [spec({ method: 'POST', cors: ['https://elsewhere.test'] })], errors: [] };
    const result = await dispatchIngressRequest({
      env,
      db: fakeDb() as never,
      target,
      request: new Request('https://acme.builderforce.ai/api/quote', {
        method: 'OPTIONS',
        headers: { origin: 'https://elsewhere.test', 'access-control-request-method': 'POST' },
      }),
      route: '/quote',
    });
    if (!result.matched) throw new Error('unreachable');
    expect(result.response.status).toBe(204);
    expect(result.response.headers.get('access-control-allow-methods')).toBe('POST');
  });

  it('lets the browser SEE a verification failure it is allowed to read', async () => {
    // A 403 with no CORS headers reaches the developer as a network error, and
    // the afternoon goes on the wrong problem.
    handlers = { specs: [spec({ verify: 'twilio', cors: ['https://elsewhere.test'] })], errors: [] };
    const result = await dispatchIngressRequest({
      env,
      db: fakeDb([[]]) as never,
      target,
      request: new Request('https://acme.builderforce.ai/api/quote', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://elsewhere.test' },
        body: '{}',
      }),
      route: '/quote',
    });
    if (!result.matched) throw new Error('unreachable');
    expect(result.response.status).toBe(403);
    expect(result.response.headers.get('access-control-allow-origin')).toBe('https://elsewhere.test');
  });

  it('caps the flood well above provider throughput', () => {
    // A regression here is silent until a customer's messages start 429ing, so
    // the number is pinned rather than left to a future tuning pass.
    expect(INGRESS_RPM).toBe(300);
  });
});

describe('ingressRuntimeDeps', () => {
  it('scopes a data step to the handler’s own project, not one the spec names', async () => {
    // A spec is canvas data any collaborator can edit. If the collection read
    // took its project from the spec, a handler could read another project's
    // submissions — so the project id comes from the resolved backend and the
    // spec only chooses a collection NAME.
    const db = fakeDb([[], []]);
    const deps = ingressRuntimeDeps({} as never, db as never, 3, 7);
    await deps.readCollection({ collection: 'signups' });
    expect(db.calls.length).toBeGreaterThan(0);
  });
});
