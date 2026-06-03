import { describe, expect, it, vi } from 'vitest';

const TENANT = 77;
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

import { createPrdRoutes } from './prdRoutes';

/**
 * Minimal Drizzle stub. `selects` is a queue of result-sets returned in order
 * by each db.select(...) chain. `inserts` is a queue of returning() result-sets.
 * Both .where(), .orderBy(), and .limit() resolve to the next queued select set;
 * the chain is also awaitable directly.
 */
function makeDb(opts: {
  selects?: unknown[][];
  inserts?: unknown[][];
  updates?: unknown[][];
} = {}) {
  const selects = [...(opts.selects ?? [])];
  const inserts = [...(opts.inserts ?? [])];
  const updates = [...(opts.updates ?? [])];
  const captured: { insertValues: any[] } = { insertValues: [] };

  function selectResult(): any {
    const rows = selects.shift() ?? [];
    // A thenable that also supports .orderBy().limit() chaining.
    const chain: any = {
      orderBy: () => {
        const c2: any = Promise.resolve(rows);
        c2.limit = async () => rows;
        return c2;
      },
      limit: async () => rows,
      then: (res: any, rej: any) => Promise.resolve(rows).then(res, rej),
    };
    return chain;
  }

  const db: any = {
    select: () => ({ from: () => ({ where: () => selectResult() }) }),
    insert: () => ({
      values: (v: any) => {
        captured.insertValues.push(v);
        const p: any = Promise.resolve(undefined);
        p.returning = async () => inserts.shift() ?? [];
        return p;
      },
    }),
    update: () => ({
      set: () => ({
        where: () => {
          const p: any = Promise.resolve(undefined);
          p.returning = async () => updates.shift() ?? [];
          return p;
        },
      }),
    }),
  };
  return { db: db as any, captured };
}

const post = (b: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(b),
});

const SPEC = {
  id: 'spec-uuid', tenantId: TENANT, agentHostId: 3, goal: 'Ship it',
  prd: '# PRD', archSpec: '# Arch', taskList: '[]',
};

describe('prdRoutes', () => {
  it('404 when spec not in tenant', async () => {
    const { db } = makeDb({ selects: [[]] });
    const res = await createPrdRoutes(db).request('/specs/spec-uuid/versions', post({}));
    expect(res.status).toBe(404);
  });

  it('creates a monotonic, unfrozen version snapshot', async () => {
    // 1) loadSpec → spec, 2) existing versions → [{version:1},{version:2}]
    const { db, captured } = makeDb({
      selects: [[SPEC], [{ version: 1 }, { version: 2 }]],
      inserts: [[{ id: 'v-uuid', version: 3, frozen: false }]],
    });
    const res = await createPrdRoutes(db).request('/specs/spec-uuid/versions', post({}));
    expect(res.status).toBe(201);
    const v = captured.insertValues[0];
    expect(v.version).toBe(3);
    expect(v.frozen).toBe(false);
    expect(v.tenantId).toBe(TENANT);
    expect(v.segmentId).toBe(SEGMENT);
  });

  it('freezes the latest version', async () => {
    // 1) loadSpec, 2) latest version (unfrozen)
    const { db } = makeDb({
      selects: [[SPEC], [{ id: 'v1', version: 1, frozen: false }]],
      updates: [[{ id: 'v1', version: 1, frozen: true }]],
    });
    const res = await createPrdRoutes(db).request('/specs/spec-uuid/freeze', post({}));
    expect(res.status).toBe(200);
    expect((await res.json() as any).frozen).toBe(true);
  });

  it('returns 409 when latest version already frozen (immutability)', async () => {
    const { db } = makeDb({
      selects: [[SPEC], [{ id: 'v1', version: 1, frozen: true }]],
    });
    const res = await createPrdRoutes(db).request('/specs/spec-uuid/freeze', post({}));
    expect(res.status).toBe(409);
  });

  it('generates a planning workflow + marks spec origin', async () => {
    // selects: loadSpec, (agentHostId resolved from spec so no tenant lookup), existing versions
    const { db, captured } = makeDb({
      selects: [[SPEC], [{ version: 1 }]],
      inserts: [
        [{ id: 'wf-uuid', workflowType: 'planning' }], // workflow insert
        [{ id: 'v-uuid', version: 2 }],                 // specVersion insert
      ],
    });
    const res = await createPrdRoutes(db).request(
      '/specs/spec-uuid/generate',
      post({ ticketDescription: 'Add billing' }),
    );
    expect(res.status).toBe(201);
    const wf = captured.insertValues[0];
    expect(wf.workflowType).toBe('planning');
    expect(wf.agentHostId).toBe(3);
    expect(wf.specId).toBe('spec-uuid');
    const sv = captured.insertValues[1];
    expect(sv.origin).toBe('generated_from_ticket');
  });

  it('appends an audit record (normalized)', async () => {
    const { db, captured } = makeDb({
      selects: [[SPEC]],
      inserts: [[{ id: 'a-uuid', action: 'edited' }]],
    });
    const res = await createPrdRoutes(db).request(
      '/specs/spec-uuid/audit',
      post({ action: 'edited', sectionId: 'goals', agentRole: 'prd-author', detail: { x: 1 } }),
    );
    expect(res.status).toBe(201);
    const a = captured.insertValues[0];
    expect(a.action).toBe('edited');
    expect(a.sectionId).toBe('goals');
    expect(a.detail).toBe(JSON.stringify({ x: 1 }));
    expect(a.tenantId).toBe(TENANT);
  });

  it('rejects an audit record with no action', async () => {
    const { db } = makeDb({ selects: [[SPEC]] });
    const res = await createPrdRoutes(db).request(
      '/specs/spec-uuid/audit',
      post({ action: '   ' }),
    );
    expect(res.status).toBe(400);
  });

  it('lists audit records with filters applied', async () => {
    const { db } = makeDb({
      selects: [[SPEC], [{ id: 'a1', agentRole: 'prd-author', swimlane: 'plan' }]],
    });
    const res = await createPrdRoutes(db).request(
      '/specs/spec-uuid/audit?agentRole=prd-author&swimlane=plan',
    );
    expect(res.status).toBe(200);
    expect((await res.json() as any).records).toHaveLength(1);
  });
});
