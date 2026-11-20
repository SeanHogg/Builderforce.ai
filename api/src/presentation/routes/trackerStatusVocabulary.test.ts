/**
 * The REST trackers for roadmap items, portfolios, initiatives and objectives hold a
 * written `status` to the same vocabulary the Brain's write tools accept (agent-loop
 * `TICKET_STATUS_VALUES`, read by the closed-status registry). A free-form status such as
 * an initiative set to "done" never reads as closed, so its ring sat at the claimed-complete
 * rung and `openOnly` listed it forever: it is answered 400 naming the allowed values, and
 * nothing is written. A status the write leaves as it was is not a change, so a row carrying
 * an off-vocabulary legacy status stays editable.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set('tenantId', 88);
    c.set('segmentId', 'seg-default');
    c.set('role', 'manager');
    await next();
  },
  requireRole: () => async (_c: any, next: any) => next(),
}));

const webhooks = vi.hoisted(() => ({ emitWebhookEvent: vi.fn(async (..._a: unknown[]) => 1) }));
vi.mock('../../application/seams/webhookService', () => webhooks);
const cache = vi.hoisted(() => ({ invalidated: [] as string[], bumped: [] as string[] }));
vi.mock('../../infrastructure/cache/readThroughCache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../infrastructure/cache/readThroughCache')>()),
  invalidateCached: vi.fn(async (_env: unknown, key: string) => { cache.invalidated.push(key); }),
  bumpCacheVersion: vi.fn(async () => undefined),
  bumpCacheVersionSafe: vi.fn(async (_env: unknown, key: string) => { cache.bumped.push(key); }),
  bumpTicketSearchVersion: vi.fn(async () => undefined),
}));
const reporter = vi.hoisted(() => ({ reportCaughtError: vi.fn() }));
vi.mock('../../application/observability/caughtErrorReporter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../application/observability/caughtErrorReporter')>()),
  reportCaughtError: reporter.reportCaughtError,
}));

import { Hono } from 'hono';
import { invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { roadmapItems } from '../../infrastructure/database/schema';
import { transitionEventId } from '../../application/seams/webhookTransition';
import { mountTrackers, type TrackerOpts } from './segmentTrackerRoutes';
import { createAgileRoutes } from './agileRoutes';
import { createPmoRoutes } from './pmoRoutes';
import { createProductRoutes } from './productRoutes';

/** A fake db: `stored` is the row a PATCH's before-image read returns. */
function makeDb(stored: Record<string, unknown> | null = null) {
  const writes: Array<Record<string, unknown>> = [];
  const returning = (row: Record<string, unknown>) => {
    const merged = { id: 'row-1', ...(stored ?? {}), ...row };
    const p: any = Promise.resolve([merged]);
    p.returning = async () => [merged];
    return p;
  };
  const selected = () => {
    const p: any = Promise.resolve(stored ? [stored] : []);
    p.limit = async () => (stored ? [stored] : []);
    return p;
  };
  const db = {
    select: () => ({ from: () => ({ where: selected }) }),
    insert: () => ({ values: (v: Record<string, unknown>) => { writes.push(v); return returning(v); } }),
    update: () => ({ set: (v: Record<string, unknown>) => { writes.push(v); return { where: () => returning(v) }; } }),
    delete: () => ({ where: () => ({ returning: async () => (stored ? [stored] : []) }) }),
  };
  return { db: db as any, writes };
}

const json = (method: string, b: unknown) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const errorOf = async (res: Response) => ((await res.json()) as { error: string }).error;

/** Each tracker: its router, path, a valid create body (without status), and its allowed / refused status. */
const TRACKERS = [
  { name: 'roadmap', routes: createProductRoutes, path: '/roadmap', create: { title: 'Billing' }, ok: 'In_Progress', bad: 'delivered', allowed: 'planned, in_progress, shipped, cancelled' },
  { name: 'portfolio', routes: createPmoRoutes, path: '/portfolios', create: { name: 'Growth' }, ok: 'archived', bad: 'done', allowed: 'active, archived, cancelled' },
  { name: 'initiative', routes: createPmoRoutes, path: '/initiatives', create: { name: 'Platform', startDate: '2026-01-01', targetDate: '2026-03-31' }, ok: 'Cancelled', bad: 'done', allowed: 'proposed, active, completed, archived, cancelled' },
  { name: 'objective', routes: createPmoRoutes, path: '/objectives', create: { title: 'Revenue', startDate: '2026-01-01', endDate: '2026-03-31' }, ok: 'achieved', bad: 'done', allowed: 'active, achieved, missed, archived, cancelled' },
] as const;

beforeEach(() => { webhooks.emitWebhookEvent.mockClear(); cache.invalidated = []; });

describe('tracker status vocabulary', () => {
  for (const t of TRACKERS) {
    it(`regression: POST ${t.path} with an unknown status answers 400 naming the allowed values, writes nothing`, async () => {
      const { db, writes } = makeDb();
      const res = await t.routes(db).request(t.path, json('POST', { ...t.create, status: t.bad }));
      expect(res.status).toBe(400);
      expect(await errorOf(res)).toContain(`${t.name} status must be one of: ${t.allowed}`);
      expect(writes).toEqual([]);
    });

    it(`regression: PATCH ${t.path}/:id that CHANGES status to an unknown value answers 400, writes nothing`, async () => {
      const { db, writes } = makeDb({ id: 'row-1', status: 'active' });
      const res = await t.routes(db).request(`${t.path}/row-1`, json('PATCH', { status: t.bad }));
      expect(res.status).toBe(400);
      expect(await errorOf(res)).toContain(`${t.name} status must be one of`);
      expect(writes).toEqual([]);
    });

    it(`regression: PATCH ${t.path}/:id on a row whose stored status is off-vocabulary stays editable`, async () => {
      const { db, writes } = makeDb({ id: 'row-1', status: 'in progress' });
      const titleOnly = await t.routes(db).request(`${t.path}/row-1`, json('PATCH', { notes: 'x', description: 'x', name: 'Renamed', title: 'Renamed' }));
      expect(titleOnly.status).toBe(200);
      // Re-sending the stored value (any case) is not a change: it passes through untouched.
      const same = await t.routes(db).request(`${t.path}/row-1`, json('PATCH', { status: 'In Progress' }));
      expect(same.status).toBe(200);
      expect(writes[1]!.status).toBe('in progress');
    });

    it(`POST and PATCH ${t.path} accept a known status, stored lower-cased`, async () => {
      const { db, writes } = makeDb({ id: 'row-1', status: 'planned' });
      const created = await t.routes(db).request(t.path, json('POST', { ...t.create, status: t.ok }));
      expect(created.status).toBe(201);
      const patched = await t.routes(db).request(`${t.path}/row-1`, json('PATCH', { status: t.ok }));
      expect(patched.status).toBe(200);
      expect(writes.map((w) => w.status)).toEqual([t.ok.toLowerCase(), t.ok.toLowerCase()]);
    });
  }

  it('a null status is refused with a clear message', async () => {
    const { db, writes } = makeDb({ id: 'row-1', status: 'active' });
    const res = await createPmoRoutes(db).request('/portfolios/row-1', json('PATCH', { status: null }));
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe('portfolio status cannot be null');
    expect(writes).toEqual([]);
  });
});

describe('roadmap tracker: legacy words and roadmap.published', () => {
  it('regression: writing a legacy "released" stores shipped and fires roadmap.published', async () => {
    const { db, writes } = makeDb({ id: 'row-1', status: 'in_progress' });
    const res = await createProductRoutes(db).request('/roadmap/row-1', json('PATCH', { status: 'released' }));
    expect(res.status).toBe(200);
    expect(writes[0]!.status).toBe('shipped');
    expect(webhooks.emitWebhookEvent).toHaveBeenCalledTimes(1);
    expect(webhooks.emitWebhookEvent.mock.calls[0]![1]).toMatchObject({ eventType: 'roadmap.published', tenantId: 88, segmentId: 'seg-default' });
  });

  it('a create straight into shipped publishes it', async () => {
    const { db } = makeDb();
    const res = await createProductRoutes(db).request('/roadmap', json('POST', { title: 'Billing', status: 'shipped' }));
    expect(res.status).toBe(201);
    expect(webhooks.emitWebhookEvent).toHaveBeenCalledTimes(1);
  });

  it('regression: a save of an item that is already shipped does not re-announce it', async () => {
    const { db } = makeDb({ id: 'row-1', status: 'shipped' });
    const res = await createProductRoutes(db).request('/roadmap/row-1', json('PATCH', { title: 'Renamed', status: 'shipped' }));
    expect(res.status).toBe(200);
    expect(webhooks.emitWebhookEvent).not.toHaveBeenCalled();
  });

  it('regression: an item already delivered under a legacy word (any case) is not re-announced when saved as shipped', async () => {
    for (const legacy of ['released', 'Done', 'Shipped']) {
      const { db } = makeDb({ id: 'row-1', status: legacy });
      const res = await createProductRoutes(db).request('/roadmap/row-1', json('PATCH', { status: 'shipped' }));
      expect(res.status, legacy).toBe(200);
    }
    expect(webhooks.emitWebhookEvent).not.toHaveBeenCalled();
  });
});

/** An env so the post-write step has a cache to clear, and an execution context for the generic emit. */
const ENV = {} as never;
const execCtx = () => {
  const deferred: Promise<unknown>[] = [];
  return { deferred, ctx: { waitUntil: (p: Promise<unknown>) => { deferred.push(p); }, passThroughOnException: () => undefined, props: {} } as never };
};
const projectKey = (ns: string, p: number | 'all') => `tracker:${ns}:t:88:s:seg-default:p:${p}`;

describe('tracker post-write step', () => {
  it('regression: a roadmap item moved between projects clears BOTH project cache keys', async () => {
    const { db } = makeDb({ id: 'row-1', status: 'planned', projectId: 3 });
    const res = await createProductRoutes(db).request('/roadmap/row-1', json('PATCH', { projectId: 9 }), ENV);
    expect(res.status).toBe(200);
    expect(cache.invalidated).toEqual(expect.arrayContaining([projectKey('roadmap', 'all'), projectKey('roadmap', 3), projectKey('roadmap', 9)]));
  });

  it('regression: deleting a roadmap item clears its cache and announces nothing', async () => {
    const { db } = makeDb({ id: 'row-1', status: 'shipped', projectId: 3 });
    const res = await createProductRoutes(db).request('/roadmap/row-1', { method: 'DELETE' }, ENV);
    expect(res.status).toBe(200);
    expect(cache.invalidated).toEqual(expect.arrayContaining([projectKey('roadmap', 'all'), projectKey('roadmap', 3)]));
    expect(webhooks.emitWebhookEvent).not.toHaveBeenCalled();
  });

  it('regression: the generic emit is transition-only — re-saving a completed sprint does not re-emit sprint.completed', async () => {
    const done = makeDb({ id: 's1', status: 'completed', projectId: 3 });
    const resave = execCtx();
    expect((await createAgileRoutes(done.db).request('/sprints/s1', json('PATCH', { status: 'completed', notes: 'x' }), ENV, resave.ctx)).status).toBe(200);
    await Promise.all(resave.deferred);
    expect(webhooks.emitWebhookEvent).not.toHaveBeenCalled();

    const open = makeDb({ id: 's1', status: 'active', projectId: 3 });
    const close = execCtx();
    expect((await createAgileRoutes(open.db).request('/sprints/s1', json('PATCH', { status: 'completed' }), ENV, close.ctx)).status).toBe(200);
    await Promise.all(close.deferred);
    expect(webhooks.emitWebhookEvent).toHaveBeenCalledTimes(1);
    expect(webhooks.emitWebhookEvent.mock.calls[0]![1]).toMatchObject({ eventType: 'sprint.completed' });
  });

  it('regression: a sprint moved between projects clears BOTH project cache keys (generic tracker)', async () => {
    const { db } = makeDb({ id: 's1', status: 'active', projectId: 3 });
    const res = await createAgileRoutes(db).request('/sprints/s1', json('PATCH', { projectId: 9 }), ENV);
    expect(res.status).toBe(200);
    expect(cache.invalidated).toEqual(expect.arrayContaining([projectKey('sprints', 'all'), projectKey('sprints', 3), projectKey('sprints', 9)]));
  });
});

/** One tracker mounted straight through the factory, under the request scope the auth middleware would set. */
function mountOne(db: unknown, opts: TrackerOpts): Hono<any> {
  const parent = new Hono<any>();
  parent.use('*', async (c, next) => { c.set('tenantId', 88); c.set('segmentId', 'seg-default'); await next(); });
  mountTrackers(parent, db as never, [{ path: '/t', table: roadmapItems, opts }]);
  return parent;
}

describe('tracker post-write step: afterWrite, version keys and cache failures', () => {
  beforeEach(() => { cache.bumped = []; reporter.reportCaughtError.mockClear(); });

  it('regression: a tracker with its own afterWrite still bumps its bumpVersionKeys', async () => {
    const afterWrite = vi.fn(async () => undefined);
    const { db } = makeDb({ id: 'row-1', title: 'Old' });
    const app = mountOne(db, { fields: ['title'], afterWrite, bumpVersionKeys: (t) => [`roi-version:tenant:${t}`] });
    const res = await app.request('/t/row-1', json('PATCH', { title: 'New' }), ENV);
    expect(res.status).toBe(200);
    expect(afterWrite).toHaveBeenCalledTimes(1);
    expect(cache.bumped).toEqual(['roi-version:tenant:88']);
  });

  it('refuses, at mount time, opts that combine afterWrite with emit', () => {
    const opts = { fields: ['title'], afterWrite: async () => undefined, emit: { field: 'status', value: 'shipped', event: 'roadmap.published' } } as unknown as TrackerOpts;
    expect(() => mountOne({}, opts)).toThrow(/afterWrite/);
  });

  it('regression: a cache invalidation failure after the write is reported, not thrown — the PATCH still succeeds', async () => {
    vi.mocked(invalidateCached).mockRejectedValueOnce(new Error('kv down'));
    const { db } = makeDb({ id: 's1', status: 'active', projectId: 3 });
    const res = await createAgileRoutes(db).request('/sprints/s1', json('PATCH', { notes: 'x' }), ENV);
    expect(res.status).toBe(200);
    expect(reporter.reportCaughtError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'kv down' }),
      expect.objectContaining({ operation: 'invalidateTracker' }),
    );
  });
});

describe('transition webhook eventId', () => {
  it('regression: a genuine re-ship is a new occurrence — the eventId carries the write instant, not just the row id', () => {
    const first = transitionEventId({ id: 'row-1', updatedAt: new Date('2026-11-01T00:00:00Z') }, 'shipped');
    const reship = transitionEventId({ id: 'row-1', updatedAt: new Date('2026-11-02T00:00:00Z') }, 'shipped');
    expect(first).toBe(`row-1:shipped:${Date.parse('2026-11-01T00:00:00Z')}`);
    expect(reship).not.toBe(first);
    // The same write (a retried delivery) is the same occurrence; an ISO string stamp reads the same.
    expect(transitionEventId({ id: 'row-1', updatedAt: '2026-11-01T00:00:00.000Z' }, 'shipped')).toBe(first);
  });

  it('the roadmap tracker announces a transition into shipped under a per-transition eventId', async () => {
    webhooks.emitWebhookEvent.mockClear();
    const { db } = makeDb({ id: 'row-1', status: 'planned' });
    const res = await createProductRoutes(db).request('/roadmap/row-1', json('PATCH', { status: 'shipped' }));
    expect(res.status).toBe(200);
    expect((webhooks.emitWebhookEvent.mock.calls[0]![1] as { eventId: string }).eventId).toMatch(/^row-1:shipped:\d+$/);
  });
});
