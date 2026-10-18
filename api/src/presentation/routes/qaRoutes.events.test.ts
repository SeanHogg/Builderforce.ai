/**
 * POST /api/qa/events must accept the capture client's UNLOAD flush.
 *
 * The client flushes on `pagehide` with `navigator.sendBeacon`
 * (frontend/src/lib/qa/telemetry.ts), which cannot set headers — so the last batch
 * of every session arrived with no Authorization and the blanket `authMiddleware`
 * answered 401. The timed flush uses `apiRequestStream` and was always
 * authenticated, which is why only the tail of each journey was lost.
 *
 * Two properties are load-bearing here, and both are about not being careless
 * with the fix:
 *
 *  1. The anonymous beacon is ACKNOWLEDGED, not rejected — otherwise the client
 *     sees a failure for a request it never made, and cannot retry it anyway.
 *  2. The anonymous batch is NEVER STORED. `qa_journey_events.tenant_id` is NOT
 *     NULL with an FK to `tenants`, and every read of that table is
 *     tenant-scoped, so an unattributable row would be written but never read
 *     back. The test asserts the Db is not touched rather than trusting that.
 *
 * The authenticated path must keep behaving exactly as before — these tests
 * would pass on a route that simply dropped everything.
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
    // Mirrors the real one's contract: delegate to the gate, swallow ONLY
    // UnauthorizedError, then continue. Swallowing anything else would hide a
    // real failure as an anonymous caller — which is what makes this safe to
    // widen a route with, and what the "still gated" test below pins down.
    optionalAuthMiddleware: async (c: any, next: () => Promise<void>) => {
      try {
        await fakeAuth(c, async () => {});
      } catch (err) {
        if (!(err instanceof UnauthorizedError)) throw err;
      }
      await next();
    },
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

describe('POST /qa/events — the unload beacon', () => {
  beforeEach(() => {
    bumpCacheVersion.mockClear();
  });

  it('accepts a headerless beacon instead of answering 401', async () => {
    // sendBeacon cannot set headers, so there is NO Authorization at all here.
    const res = await app().request('/api/qa/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(BODY),
    }, ENV);

    expect(res.status).not.toBe(401);
    expect(res.status).toBe(201);
    // 201 rather than an error: the client treats this as fire-and-forget and must
    // not be told it failed when the batch was merely unattributable.
    expect(await res.json()).toMatchObject({ inserted: 0 });
  });

  it('never stores an unattributable batch', async () => {
    const { db, inserted } = recordingDb();
    const res = await app(db).request('/api/qa/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(BODY),
    }, ENV);

    expect(res.status).toBe(201);
    // The whole point: a row with no tenant could be written but never read back.
    expect(inserted).toEqual([]);
    expect(bumpCacheVersion).not.toHaveBeenCalled();
  });

  it('still rejects a malformed batch, so garbage is not silently accepted', async () => {
    const res = await app().request('/api/qa/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

    // Widening POST must not have widened the reads that return tenant data.
    expect(res.status).toBe(401);
  });
});