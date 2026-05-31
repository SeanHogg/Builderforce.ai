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

import { createProductRoutes } from './productRoutes';

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

describe('productRoutes (via the shared tracker factory)', () => {
  it('lists MVP scenarios scoped to the segment', async () => {
    const rows = [{ id: 'm1', name: 'Lite tier' }];
    const { db } = makeDb({ listRows: rows });
    const res = await createProductRoutes(db).request('/mvp');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(rows);
  });

  it('creates an MVP scenario, tenant+segment stamped, whitelisted only', async () => {
    const { db, captured } = makeDb({ insertReturn: [{ id: 'm1' }] });
    const res = await createProductRoutes(db).request('/mvp', post({ name: 'Lite tier', pricingModel: 'SAAS', evil: 'x' }));
    expect(res.status).toBe(201);
    expect(captured.insertValues.tenantId).toBe(TENANT);
    expect(captured.insertValues.segmentId).toBe(SEGMENT);
    expect(captured.insertValues.name).toBe('Lite tier');
    expect('evil' in captured.insertValues).toBe(false);
  });

  it('rejects an MVP scenario with no name', async () => {
    const { db } = makeDb();
    const res = await createProductRoutes(db).request('/mvp', post({ pricingModel: 'SAAS' }));
    expect(res.status).toBe(400);
  });

  it('mounts the changelog tracker too', async () => {
    const { db } = makeDb({ listRows: [] });
    const res = await createProductRoutes(db).request('/changelog');
    expect(res.status).toBe(200);
  });
});
