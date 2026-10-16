/**
 * `Idempotency-Key` replay — the guarantee an offline client's outbox rests on: a write
 * sent twice under one key executes once, and the second attempt gets the first answer.
 */
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';

import type { HonoEnv } from '../../env';
import type { IdempotencyStore, StoredIdempotentResponse } from '../../application/shared/idempotentReplay';
import { parseIdempotencyKey } from '../../application/shared/idempotentReplay';
import { createCacheIdempotencyStore } from '../../application/shared/idempotencyReplayStore';
import { idempotentReplay } from './idempotentReplay';

function memoryStore(): IdempotencyStore {
  const rows = new Map<string, StoredIdempotentResponse>();
  return {
    get: async (t, k) => rows.get(`${t}:${k}`) ?? null,
    put: async (t, k, r) => {
      rows.set(`${t}:${k}`, r);
    },
  };
}

function app(opts: { tenantId?: number | null; status?: number } = {}) {
  const store = memoryStore();
  let runs = 0;
  const a = new Hono<HonoEnv>();
  a.use('*', async (c, next) => {
    const tenant = c.req.header('x-tenant');
    const id = tenant ? Number(tenant) : opts.tenantId;
    if (typeof id === 'number') c.set('tenantId', id);
    await next();
  });
  const guard = idempotentReplay({ store: () => store });
  const handler = (c: import('hono').Context<HonoEnv>) => {
    runs += 1;
    return c.json({ run: runs }, (opts.status ?? 201) as 201);
  };
  a.post('/ingest', guard, handler);
  a.post('/other', guard, handler);
  return { app: a, runs: () => runs };
}

const post = (a: Hono<HonoEnv>, path: string, headers: Record<string, string> = {}) =>
  a.request(path, { method: 'POST', headers });

describe('idempotentReplay', () => {
  it('runs every request when no key is sent', async () => {
    const t = app({ tenantId: 1 });
    await post(t.app, '/ingest');
    await post(t.app, '/ingest');
    expect(t.runs()).toBe(2);
  });

  it('executes once per key and replays the first response verbatim', async () => {
    const t = app({ tenantId: 1 });
    const first = await post(t.app, '/ingest', { 'Idempotency-Key': 'k-1' });
    const second = await post(t.app, '/ingest', { 'Idempotency-Key': 'k-1' });
    expect(t.runs()).toBe(1);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(await second.json()).toEqual({ run: 1 });
    expect(second.headers.get('x-builderforce-idempotent-replay')).toBe('true');
    expect(first.headers.get('x-builderforce-idempotent-replay')).toBeNull();
  });

  it('scopes keys by tenant', async () => {
    const t = app();
    await post(t.app, '/ingest', { 'Idempotency-Key': 'k-1', 'x-tenant': '1' });
    await post(t.app, '/ingest', { 'Idempotency-Key': 'k-1', 'x-tenant': '2' });
    expect(t.runs()).toBe(2);
  });

  it('refuses a key reused on a different route', async () => {
    const t = app({ tenantId: 1 });
    await post(t.app, '/ingest', { 'Idempotency-Key': 'k-1' });
    const res = await post(t.app, '/other', { 'Idempotency-Key': 'k-1' });
    expect(res.status).toBe(422);
    expect(t.runs()).toBe(1);
  });

  it('does not store a refusal, so a corrected retry runs', async () => {
    const t = app({ tenantId: 1, status: 400 });
    await post(t.app, '/ingest', { 'Idempotency-Key': 'k-1' });
    await post(t.app, '/ingest', { 'Idempotency-Key': 'k-1' });
    expect(t.runs()).toBe(2);
  });

  it('answers 400 to a malformed key instead of ignoring it', async () => {
    const t = app({ tenantId: 1 });
    const res = await post(t.app, '/ingest', { 'Idempotency-Key': 'x'.repeat(129) });
    expect(res.status).toBe(400);
    expect(t.runs()).toBe(0);
  });

  it('leaves an unauthenticated request to the handler', async () => {
    const t = app({ tenantId: null });
    await post(t.app, '/ingest', { 'Idempotency-Key': 'k-1' });
    await post(t.app, '/ingest', { 'Idempotency-Key': 'k-1' });
    expect(t.runs()).toBe(2);
  });
});

describe('parseIdempotencyKey', () => {
  it('accepts visible ASCII up to 128 chars and rejects the rest', () => {
    expect(parseIdempotencyKey(undefined)).toBeNull();
    expect(parseIdempotencyKey('  ')).toBeNull();
    expect(parseIdempotencyKey(' abc-123 ')).toBe('abc-123');
    expect(parseIdempotencyKey('has space')).toBe('invalid');
    expect(parseIdempotencyKey('é')).toBe('invalid');
  });
});

describe('createCacheIdempotencyStore', () => {
  it('round-trips a response through the read-through cache, per tenant', async () => {
    const store = createCacheIdempotencyStore(undefined);
    const response = { fingerprint: 'POST /x', status: 202, body: '{}', contentType: 'application/json' };
    await store.put(7, 'k', response);
    expect(await store.get(7, 'k')).toEqual(response);
    expect(await store.get(8, 'k')).toBeNull();
  });
});
