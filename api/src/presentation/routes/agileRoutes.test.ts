import { describe, expect, it, vi } from 'vitest';

const TENANT = 91;
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

import { createAgileRoutes } from './agileRoutes';

function makeDb(opts: { listRows?: unknown[]; insertReturn?: unknown[] } = {}) {
  const captured: { insertValues?: any } = {};
  const db = {
    select: () => ({ from: () => ({ where: async () => opts.listRows ?? [] }) }),
    insert: () => ({
      values: (v: any) => {
        captured.insertValues = v;
        const p: any = Promise.resolve(undefined);
        p.returning = async () => opts.insertReturn ?? [];
        return p;
      },
    }),
  };
  return { db: db as any, captured };
}

const post = (b: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });

describe('agileRoutes (shared tracker factory)', () => {
  it('lists sprints scoped to the segment', async () => {
    const rows = [{ id: 's1', name: 'Sprint 1' }];
    const { db } = makeDb({ listRows: rows });
    const res = await createAgileRoutes(db).request('/sprints');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(rows);
  });

  it('creates a sprint, tenant+segment stamped', async () => {
    const { db, captured } = makeDb({ insertReturn: [{ id: 's1' }] });
    const res = await createAgileRoutes(db).request('/sprints', post({ name: 'Sprint 1', capacity: 20 }));
    expect(res.status).toBe(201);
    expect(captured.insertValues.tenantId).toBe(TENANT);
    expect(captured.insertValues.segmentId).toBe(SEGMENT);
    expect(captured.insertValues.name).toBe('Sprint 1');
  });

  it('mounts the feature-scoring (RICE) tracker', async () => {
    const { db } = makeDb({ listRows: [] });
    const res = await createAgileRoutes(db).request('/feature-scoring');
    expect(res.status).toBe(200);
  });
});
