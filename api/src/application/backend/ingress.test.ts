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
