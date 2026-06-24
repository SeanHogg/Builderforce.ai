import { describe, expect, it, vi } from 'vitest';

const TENANT = 88;
const SEGMENT = 'seg-default';
vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set('tenantId', TENANT);
    c.set('segmentId', SEGMENT);
    c.set('role', 'manager');
    await next();
  },
  requireRole: () => async (_c: any, next: any) => next(),
}));

import { createInnovationRoutes } from './innovationRoutes';

function makeDb(opts: { rows?: unknown[]; insertReturn?: unknown[] } = {}) {
  const captured: { insertValues?: any } = {};
  const make = (rows: unknown[]): any => {
    const b: any = {
      from: () => b, where: () => b, groupBy: () => b, orderBy: () => b, limit: () => b, set: () => b,
      returning: () => Promise.resolve(rows),
      then: (res: any, rej: any) => Promise.resolve(rows).then(res, rej),
    };
    return b;
  };
  const db = {
    select: () => make(opts.rows ?? []),
    insert: () => ({ values: (v: any) => { captured.insertValues = v; return make(opts.insertReturn ?? []); } }),
    update: () => make(opts.insertReturn ?? []),
    delete: () => make(opts.insertReturn ?? []),
  };
  return { db: db as any, captured };
}

const post = (b: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });

describe('innovationRoutes', () => {
  it('GET /funnel returns conversion metrics (empty-safe)', async () => {
    const { db } = makeDb();
    const res = await createInnovationRoutes(db).request('/funnel');
    expect(res.status).toBe(200);
    const j = await res.json() as any;
    expect(j.activeIdeas).toBe(0);
    expect(j.ideaToShipPct).toBeNull();
    expect(j.stages).toHaveLength(5);
  });

  it('lists ideas scoped to the segment', async () => {
    const rows = [{ id: 'x1', title: 'AI changelog' }];
    const { db } = makeDb({ rows });
    const res = await createInnovationRoutes(db).request('/ideas');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(rows);
  });

  it('rejects an idea with no title', async () => {
    const { db } = makeDb();
    const res = await createInnovationRoutes(db).request('/ideas', post({ stage: 'idea' }));
    expect(res.status).toBe(400);
  });

  it('creates an idea, stamped + whitelisted (stageEnteredAt is trigger-owned)', async () => {
    const { db, captured } = makeDb({ insertReturn: [{ id: 'x1' }] });
    const res = await createInnovationRoutes(db).request('/ideas', post({ title: 'AI changelog', stage: 'validated', impact: 8, stageEnteredAt: 'hacked', evil: 'x' }));
    expect(res.status).toBe(201);
    expect(captured.insertValues.tenantId).toBe(TENANT);
    expect(captured.insertValues.segmentId).toBe(SEGMENT);
    expect(captured.insertValues.title).toBe('AI changelog');
    expect(captured.insertValues.stage).toBe('validated');
    expect('stageEnteredAt' in captured.insertValues).toBe(false);
    expect('evil' in captured.insertValues).toBe(false);
  });
});
