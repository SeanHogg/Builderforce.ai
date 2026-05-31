import { describe, expect, it, vi } from 'vitest';

const TENANT = 55;
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

import { createGovernanceRoutes } from './governanceRoutes';

function whereResult(awaited: unknown[], limited: unknown[]) {
  const p: any = Promise.resolve(awaited);
  p.limit = async () => limited;
  return p;
}

function makeDb(opts: { controls?: unknown[]; existing?: unknown[]; updateRows?: unknown[]; insertReturn?: unknown[] } = {}) {
  const captured: { insertValues?: any; updateSet?: any } = {};
  const db = {
    select: () => ({ from: () => ({ where: () => whereResult(opts.controls ?? [], opts.existing ?? []) }) }),
    insert: () => ({
      values: (v: any) => {
        captured.insertValues = v;
        const p: any = Promise.resolve(undefined);
        p.returning = async () => opts.insertReturn ?? [];
        return p;
      },
    }),
    update: () => ({
      set: (s: any) => {
        captured.updateSet = s;
        return { where: () => ({ returning: async () => opts.updateRows ?? [] }) };
      },
    }),
  };
  return { db: db as any, captured };
}

const body = (method: string, b: unknown) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });

describe('governanceRoutes /soc2', () => {
  it('lists controls for the active segment', async () => {
    const rows = [{ id: 'c1', controlRef: 'CC1.1' }];
    const { db } = makeDb({ controls: rows });
    const res = await createGovernanceRoutes(db).request('/soc2/controls');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(rows);
  });

  it('seeds the CC1–CC9 baseline (tenant+segment stamped) when empty', async () => {
    const { db, captured } = makeDb({ existing: [] });
    const res = await createGovernanceRoutes(db).request('/soc2/seed', body('POST', {}));
    expect(res.status).toBe(201);
    const json = await res.json() as { seeded: number };
    expect(json.seeded).toBeGreaterThanOrEqual(25);
    // Every seeded row carries the scope.
    expect(captured.insertValues.length).toBe(json.seeded);
    expect(captured.insertValues.every((r: any) => r.tenantId === TENANT && r.segmentId === SEGMENT)).toBe(true);
    expect(captured.insertValues[0].controlRef).toBe('CC1.1');
  });

  it('does not re-seed when a baseline already exists', async () => {
    const { db, captured } = makeDb({ existing: [{ id: 'c1' }] });
    const res = await createGovernanceRoutes(db).request('/soc2/seed', body('POST', {}));
    expect(res.status).toBe(200);
    expect((await res.json() as { seeded: number }).seeded).toBe(0);
    expect(captured.insertValues).toBeUndefined();
  });

  it('rejects an invalid control status', async () => {
    const { db } = makeDb();
    const res = await createGovernanceRoutes(db).request('/soc2/controls/c1', body('PATCH', { status: 'nope' }));
    expect(res.status).toBe(400);
  });

  it('updates a control status (scoped to tenant+segment)', async () => {
    const { db, captured } = makeDb({ updateRows: [{ id: 'c1', status: 'ready' }] });
    const res = await createGovernanceRoutes(db).request('/soc2/controls/c1', body('PATCH', { status: 'ready' }));
    expect(res.status).toBe(200);
    expect(captured.updateSet.status).toBe('ready');
  });

  it('404s updating a control that is not in this segment', async () => {
    const { db } = makeDb({ updateRows: [] });
    const res = await createGovernanceRoutes(db).request('/soc2/controls/cX', body('PATCH', { status: 'ready' }));
    expect(res.status).toBe(404);
  });

  it('requires title + evidenceType when attaching evidence', async () => {
    const { db } = makeDb({ existing: [{ id: 'c1' }] });
    const res = await createGovernanceRoutes(db).request('/soc2/controls/c1/evidence', body('POST', { url: 'x' }));
    expect(res.status).toBe(400);
  });
});
