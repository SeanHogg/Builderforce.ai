/**
 * POST /api/qa/events is AUTHENTICATED.
 *
 * The capture client used to flush on `pagehide` with `navigator.sendBeacon`, which
 * cannot set headers, and the route answered that headerless batch with a 201 and
 * dropped it — every session's tail was lost while the client was told it landed.
 * The client now sends every flush, the unload one included, through
 * `apiRequestStream(..., { keepalive: true })`, which carries the bearer — so the
 * route rejects an unauthenticated batch (401) instead of pretending to accept it.
 *
 * The authenticated path must keep behaving exactly as before.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

const { bumpCacheVersion } = vi.hoisted(() => ({ bumpCacheVersion: vi.fn(async () => {}) }));

vi.mock('../../infrastructure/cache/readThroughCache', () => ({ bumpCacheVersion }));

vi.mock('../middleware/authMiddleware', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/authMiddleware')>();
  const { UnauthorizedError } = await import('../../domain/shared/errors');

  // Stands in for the real gate. The real one verifies a JWT and reads membership
  // off Postgres; all this route cares about is the distinction the fix turns on —
  // absent header means no tenant on the context, present header means one.
  const fakeAuth = async (c: any, next: () => Promise<void>) => {
    if (c.req.header('Authorization') !== 'Bearer tenant-token') {
      throw new UnauthorizedError('Missing or malformed Authorization header');
    }
    c.set('tenantId', 91);
    c.set('userId', 'user-1');
    c.set('segmentId', 'segment-1');
    await next();
  };

  return {
    ...actual,
    authMiddleware: fakeAuth,
  };
});

import { createQaRoutes } from './qaRoutes';
import { errorHandler } from '../middleware/errorHandler';

const ENV = { JWT_SECRET: 'test-secret' } as any;

/**
 * Records which table each handler writes to, so "was this batch stored?" is a
 * direct observation rather than an inference from a status code. `values()` is
 * a no-op chain — the point is that it was REACHED, not what it did.
 */
function recordingDb(): { db: Db; inserted: unknown[] } {
  const inserted: unknown[] = [];
  const db = {
    insert: (table: unknown) => {
      inserted.push(table);
      return { values: () => ({ then: (res: () => void) => res() }) };
    },
  } as unknown as Db;
  return { db, inserted };
}

/**
 * A bare router would answer 500 for a thrown `UnauthorizedError` — it has no
 * error handler — so the gate's rejection could not be observed as the 401 it is
 * in production. Mounting `errorHandler` is what makes these assertions real.
 */
function app(db: Db = {} as Db): Hono<HonoEnv> {
  const root = new Hono<HonoEnv>();
  root.onError(errorHandler);
  root.route('/api/qa', createQaRoutes(db, {} as any, {} as any));
  return root;
}

const BODY = {
  sessionId: 's_abc123',
  events: [{ type: 'pageview', route: '/dashboard', seq: 0 }],
};

describe('POST /qa/events — an unauthenticated batch', () => {
  beforeEach(() => {
    bumpCacheVersion.mockClear();
  });

  it('is rejected (401), never acknowledged-and-dropped', async () => {
    const { db, inserted } = recordingDb();
    const res = await app(db).request('/api/qa/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(BODY),
    }, ENV);

    expect(res.status).toBe(401);
    expect(inserted).toEqual([]);
    expect(bumpCacheVersion).not.toHaveBeenCalled();
  });
});

describe('POST /qa/events — validation', () => {
  it('rejects a malformed authenticated batch, so garbage is not silently accepted', async () => {
    const res = await app().request('/api/qa/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tenant-token' },
      body: JSON.stringify({ events: [{ type: 'click' }] }), // no sessionId
    }, ENV);

    expect(res.status).toBe(400);
  });
});

describe('POST /qa/events — an authenticated flush is unchanged', () => {
  beforeEach(() => {
    bumpCacheVersion.mockClear();
  });

  it('attributes the batch to the caller tenant and stores it', async () => {
    const { db, inserted } = recordingDb();
    const res = await app(db).request('/api/qa/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tenant-token' },
      body: JSON.stringify(BODY),
    }, ENV);

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ inserted: 1 });
    expect(inserted).toHaveLength(1);
    // The heatmap version bump still fires, or the ranking would serve stale.
    expect(bumpCacheVersion).toHaveBeenCalled();
  });
});

describe('GET /qa/events — still gated', () => {
  it('keeps the blanket auth on every other QA endpoint', async () => {
    const res = await app().request('/api/qa/events', {}, ENV);

    expect(res.status).toBe(401);
  });
});