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

import { createPmoRoutes } from './pmoRoutes';

function makeDb(opts: { listRows?: unknown[]; insertReturn?: unknown[]; updateReturn?: unknown[] } = {}) {
  const captured: { insertValues?: any; updateSet?: any } = {};
  const returning = (rows: unknown[]) => {
    const p: any = Promise.resolve(rows);
    p.returning = async () => rows;
    return p;
  };
  const db = {
    select: () => ({ from: () => ({ where: async () => opts.listRows ?? [] }) }),
    insert: () => ({
      values: (v: any) => {
        captured.insertValues = v;
        return returning(opts.insertReturn ?? []);
      },
    }),
    update: () => ({
      set: (v: any) => {
        captured.updateSet = v;
        return { where: () => returning(opts.updateReturn ?? []) };
      },
    }),
  };
  return { db: db as any, captured };
}

const json = (method: string, b: unknown) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });

describe('pmoRoutes — tracker CRUD (shared factory)', () => {
  it('lists portfolios scoped to the segment', async () => {
    const rows = [{ id: 'p1', name: 'Platform' }];
    const { db } = makeDb({ listRows: rows });
    const res = await createPmoRoutes(db).request('/portfolios');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(rows);
  });

  it('creates an initiative, tenant+segment stamped, whitelisted only', async () => {
    const { db, captured } = makeDb({ insertReturn: [{ id: 'i1' }] });
    const res = await createPmoRoutes(db).request(
      '/initiatives',
      json('POST', { name: 'Self-serve onboarding', portfolioId: 'p1', evil: 'x' }),
    );
    expect(res.status).toBe(201);
    expect(captured.insertValues.tenantId).toBe(TENANT);
    expect(captured.insertValues.segmentId).toBe(SEGMENT);
    expect(captured.insertValues.name).toBe('Self-serve onboarding');
    expect(captured.insertValues.portfolioId).toBe('p1');
    expect('evil' in captured.insertValues).toBe(false);
  });

  it('rejects an objective with no title', async () => {
    const { db } = makeDb();
    const res = await createPmoRoutes(db).request('/objectives', json('POST', { period: '2026-Q2' }));
    expect(res.status).toBe(400);
  });

  it('rejects a key result with no objectiveId', async () => {
    const { db } = makeDb();
    const res = await createPmoRoutes(db).request('/key-results', json('POST', { title: 'Activation %' }));
    expect(res.status).toBe(400);
  });
});

describe('pmoRoutes — rollup validation', () => {
  it('400s when scope kind is missing or invalid', async () => {
    const { db } = makeDb();
    expect((await createPmoRoutes(db).request('/rollup?id=p1')).status).toBe(400);
    expect((await createPmoRoutes(db).request('/rollup?kind=team&id=p1')).status).toBe(400);
  });

  it('400s when id is missing', async () => {
    const { db } = makeDb();
    expect((await createPmoRoutes(db).request('/rollup?kind=portfolio')).status).toBe(400);
  });
});

describe('pmoRoutes — project link', () => {
  it('400s on a non-numeric projectId', async () => {
    const { db } = makeDb();
    const res = await createPmoRoutes(db).request('/projects/abc/link', json('PATCH', { initiativeId: 'i1' }));
    expect(res.status).toBe(400);
  });

  it('unlinks a project (initiativeId null) without an initiative lookup', async () => {
    const { db, captured } = makeDb({ updateReturn: [{ id: 7, initiativeId: null }] });
    const res = await createPmoRoutes(db).request('/projects/7/link', json('PATCH', { initiativeId: null }));
    expect(res.status).toBe(200);
    expect(captured.updateSet.initiativeId).toBeNull();
    expect(await res.json()).toEqual({ id: 7, initiativeId: null });
  });

  it('404s when the project does not exist', async () => {
    const { db } = makeDb({ updateReturn: [] });
    const res = await createPmoRoutes(db).request('/projects/999/link', json('PATCH', { initiativeId: null }));
    expect(res.status).toBe(404);
  });
});
