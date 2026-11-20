/**
 * The REST trackers for roadmap items, portfolios, initiatives and objectives hold a
 * written `status` to the same vocabulary the Brain's write tools accept (agent-loop
 * `TICKET_STATUS_VALUES`, read by the closed-status registry). A free-form status such as
 * an initiative set to "done" never reads as closed, so its ring sat at the claimed-complete
 * rung and `openOnly` listed it forever: it is answered 400 naming the allowed values, and
 * nothing is written.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set('tenantId', 88);
    c.set('segmentId', 'seg-default');
    c.set('role', 'manager');
    await next();
  },
  requireRole: () => async (_c: any, next: any) => next(),
}));

import { createPmoRoutes } from './pmoRoutes';
import { createProductRoutes } from './productRoutes';

function makeDb() {
  const writes: Array<Record<string, unknown>> = [];
  const returning = (row: Record<string, unknown>) => {
    const p: any = Promise.resolve([{ id: 'row-1', ...row }]);
    p.returning = async () => [{ id: 'row-1', ...row }];
    return p;
  };
  const db = {
    select: () => ({ from: () => ({ where: async () => [] }) }),
    insert: () => ({ values: (v: Record<string, unknown>) => { writes.push(v); return returning(v); } }),
    update: () => ({ set: (v: Record<string, unknown>) => { writes.push(v); return { where: () => returning(v) }; } }),
  };
  return { db: db as any, writes };
}

const json = (method: string, b: unknown) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });

/**
 * Each tracker: its router, path, a valid create body (without status), and its allowed / refused
 * status. Roadmap's accepted case is `in_progress`, not `shipped`: `shipped` fires the
 * `roadmap.published` webhook, which needs an ExecutionContext the test request has none of.
 */
const TRACKERS = [
  { name: 'roadmap', routes: createProductRoutes, path: '/roadmap', create: { title: 'Billing' }, ok: 'In_Progress', bad: 'delivered', allowed: 'planned, in_progress, shipped, cancelled' },
  { name: 'portfolio', routes: createPmoRoutes, path: '/portfolios', create: { name: 'Growth' }, ok: 'archived', bad: 'done', allowed: 'active, archived' },
  { name: 'initiative', routes: createPmoRoutes, path: '/initiatives', create: { name: 'Platform', startDate: '2026-01-01', targetDate: '2026-03-31' }, ok: 'completed', bad: 'done', allowed: 'proposed, active, completed, archived' },
  { name: 'objective', routes: createPmoRoutes, path: '/objectives', create: { title: 'Revenue', startDate: '2026-01-01', endDate: '2026-03-31' }, ok: 'achieved', bad: 'done', allowed: 'active, achieved, missed, archived' },
] as const;

describe('tracker status vocabulary', () => {
  for (const t of TRACKERS) {
    it(`regression: POST ${t.path} with an unknown status answers 400 naming the allowed values, writes nothing`, async () => {
      const { db, writes } = makeDb();
      const res = await t.routes(db).request(t.path, json('POST', { ...t.create, status: t.bad }));
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toContain(`${t.name} status must be one of: ${t.allowed}`);
      expect(writes).toEqual([]);
    });

    it(`regression: PATCH ${t.path}/:id with an unknown status answers 400, writes nothing`, async () => {
      const { db, writes } = makeDb();
      const res = await t.routes(db).request(`${t.path}/row-1`, json('PATCH', { status: t.bad }));
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toContain(`${t.name} status must be one of`);
      expect(writes).toEqual([]);
    });

    it(`POST and PATCH ${t.path} accept a known status, stored lower-cased`, async () => {
      const { db, writes } = makeDb();
      const created = await t.routes(db).request(t.path, json('POST', { ...t.create, status: t.ok }));
      expect(created.status).toBe(201);
      const patched = await t.routes(db).request(`${t.path}/row-1`, json('PATCH', { status: t.ok }));
      expect(patched.status).toBe(200);
      expect(writes.map((w) => w.status)).toEqual([t.ok.toLowerCase(), t.ok.toLowerCase()]);
    });
  }

  it('a write without a status is not checked', async () => {
    const { db, writes } = makeDb();
    const res = await createPmoRoutes(db).request('/portfolios/row-1', json('PATCH', { name: 'Renamed' }));
    expect(res.status).toBe(200);
    expect(writes[0]).not.toHaveProperty('status');
  });
});
