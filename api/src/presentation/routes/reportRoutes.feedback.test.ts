import { describe, expect, it, vi } from 'vitest';

const TENANT = 9;
vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set('tenantId', TENANT);
    c.set('segmentId', 'seg-1');
    c.set('role', 'manager');
    await next();
  },
  requireRole: () => async (_c: any, next: any) => next(),
}));

import { createReportRoutes } from './reportRoutes';

/**
 * Chainable db mock. The list route ends `.where().orderBy().limit()`; the triage
 * route's task lookup ends `.where().limit()`; the update ends
 * `.set().where().returning()`. We serve `taskRows` for the task lookup and
 * `updateReturns` for the update.
 */
function makeDb(opts: { listRows?: unknown[]; taskRows?: unknown[]; updateReturns?: unknown[] } = {}) {
  const captured: { updateSet?: any } = {};
  let selectCall = 0;
  const db = {
    select: () => {
      const call = selectCall++;
      return {
        from: () => ({
          where: () => ({
            orderBy: () => ({ limit: async () => opts.listRows ?? [] }),
            // The triage task lookup is the first select on the PATCH path.
            limit: async () => (call === 0 ? opts.taskRows ?? [] : []),
          }),
        }),
      };
    },
    update: () => ({
      set: (s: any) => {
        captured.updateSet = s;
        return { where: () => ({ returning: async () => opts.updateReturns ?? [] }) };
      },
    }),
  };
  return { db: db as any, captured };
}

const patchJson = (body: unknown) => ({ method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('reportRoutes Voice-of-Customer inbox', () => {
  it('GET /feedback lists the segment feedback', async () => {
    const { db } = makeDb({ listRows: [{ id: 'fb1', text: 'love it', status: 'new' }] });
    const res = await createReportRoutes(db).request('/feedback');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ feedback: [{ id: 'fb1', text: 'love it', status: 'new' }] });
  });

  it('PATCH /feedback/:id rejects an invalid status', async () => {
    const { db } = makeDb();
    const res = await createReportRoutes(db).request('/feedback/fb1', patchJson({ status: 'bogus' }));
    expect(res.status).toBe(400);
  });

  it('PATCH /feedback/:id triages to triaged and stamps triagedAt', async () => {
    const { db, captured } = makeDb({ updateReturns: [{ id: 'fb1', status: 'triaged', triagedTaskId: null }] });
    const res = await createReportRoutes(db).request('/feedback/fb1', patchJson({ status: 'triaged' }));
    expect(res.status).toBe(200);
    expect(captured.updateSet.status).toBe('triaged');
    expect(captured.updateSet.triagedAt).toBeInstanceOf(Date);
    expect(captured.updateSet.triagedTaskId).toBeNull();
  });

  it('PATCH /feedback/:id links a same-segment backlog task when triaging', async () => {
    const { db, captured } = makeDb({
      taskRows: [{ id: 42 }],
      updateReturns: [{ id: 'fb1', status: 'triaged', triagedTaskId: 42 }],
    });
    const res = await createReportRoutes(db).request('/feedback/fb1', patchJson({ status: 'triaged', taskId: 42 }));
    expect(res.status).toBe(200);
    expect(captured.updateSet.triagedTaskId).toBe(42);
  });

  it('PATCH /feedback/:id rejects a taskId not in the segment', async () => {
    const { db } = makeDb({ taskRows: [] }); // task lookup returns nothing
    const res = await createReportRoutes(db).request('/feedback/fb1', patchJson({ status: 'triaged', taskId: 999 }));
    expect(res.status).toBe(400);
  });

  it('PATCH /feedback/:id dismissing clears any triage linkage', async () => {
    const { db, captured } = makeDb({ updateReturns: [{ id: 'fb1', status: 'dismissed', triagedTaskId: null }] });
    const res = await createReportRoutes(db).request('/feedback/fb1', patchJson({ status: 'dismissed' }));
    expect(res.status).toBe(200);
    expect(captured.updateSet.triagedAt).toBeNull();
    expect(captured.updateSet.triagedTaskId).toBeNull();
  });

  it('PATCH /feedback/:id returns 404 when the row does not exist', async () => {
    const { db } = makeDb({ updateReturns: [] });
    const res = await createReportRoutes(db).request('/feedback/missing', patchJson({ status: 'triaged' }));
    expect(res.status).toBe(404);
  });
});
