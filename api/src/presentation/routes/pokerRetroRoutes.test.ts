import { describe, expect, it, vi } from 'vitest';

const TENANT = 93;
const SEGMENT = 'seg-default';
const USER = 'user-1';
vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set('tenantId', TENANT);
    c.set('segmentId', SEGMENT);
    c.set('userId', USER);
    c.set('role', 'manager');
    await next();
  },
  requireRole: () => async (_c: any, next: any) => next(),
}));

import { createAgileRoutes } from './agileRoutes';

function makeDb(insertReturn: unknown[] = [{ id: 'x1' }]) {
  const captured: { insertValues?: any } = {};
  const db = {
    select: () => ({ from: () => ({ where: () => Object.assign(Promise.resolve([{ count: 0 }]), { limit: async () => [], orderBy: async () => [] }) }) }),
    insert: () => ({
      values: (v: any) => {
        captured.insertValues = v;
        const p: any = Promise.resolve(undefined);
        p.returning = async () => insertReturn;
        p.onConflictDoUpdate = async () => undefined;
        return p;
      },
    }),
  };
  return { db: db as any, captured };
}

const post = (b?: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b ?? {}) });

describe('poker routes', () => {
  it('requires a name to start a session', async () => {
    const { db } = makeDb();
    const res = await createAgileRoutes(db).request('/poker/sessions', post({}));
    expect(res.status).toBe(400);
  });

  it('creates a session stamped with tenant/segment/facilitator', async () => {
    const { db, captured } = makeDb([{ id: 'sess1' }]);
    const res = await createAgileRoutes(db).request('/poker/sessions', post({ name: 'Sprint 12' }));
    expect(res.status).toBe(201);
    expect(captured.insertValues.tenantId).toBe(TENANT);
    expect(captured.insertValues.segmentId).toBe(SEGMENT);
    expect(captured.insertValues.facilitatorId).toBe(USER);
  });

  it('requires a value to vote', async () => {
    const { db } = makeDb();
    const res = await createAgileRoutes(db).request('/poker/stories/s1/vote', post({}));
    expect(res.status).toBe(400);
  });
});

describe('retro routes', () => {
  it('requires a name to create a retro', async () => {
    const { db } = makeDb();
    const res = await createAgileRoutes(db).request('/retros', post({}));
    expect(res.status).toBe(400);
  });

  it('requires category + content to add an item', async () => {
    const { db } = makeDb();
    const res = await createAgileRoutes(db).request('/retros/r1/items', post({ category: 'Start' }));
    expect(res.status).toBe(400);
  });

  it('adds an item stamped with author + segment', async () => {
    const { db, captured } = makeDb([{ id: 'i1' }]);
    const res = await createAgileRoutes(db).request('/retros/r1/items', post({ category: 'Start', content: 'Pair more' }));
    expect(res.status).toBe(201);
    expect(captured.insertValues.tenantId).toBe(TENANT);
    expect(captured.insertValues.segmentId).toBe(SEGMENT);
    expect(captured.insertValues.authorId).toBe(USER);
  });
});
