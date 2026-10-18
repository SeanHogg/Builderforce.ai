import { describe, expect, it, vi } from 'vitest';

// Stub the S2S auth + access-error renderer so we exercise the handler logic
// (validation, idempotency, scoping) without the full requireTenantAccess stack.
vi.mock('../middleware/serviceTokenAuth', () => ({
  authenticateServiceToken: async () => ({ tenantId: 1, segmentId: 'seg-1', tenantApiKeyId: 'k1' }),
}));
vi.mock('./llmRoutes', () => ({
  respondToAccessError: (c: any, e: unknown) => c.json({ error: String(e) }, 401),
}));

import { createSeamRoutes } from './seamRoutes';

function makeDb(opts: {
  insertReturns?: unknown[];
  selectReturns?: unknown[];
  deleteReturns?: unknown[];
} = {}) {
  const captured: { insertValues?: any } = {};
  const db = {
    insert: () => ({
      values: (v: any) => {
        captured.insertValues = v;
        const ret = { returning: async () => opts.insertReturns ?? [] };
        return { onConflictDoNothing: () => ret, returning: ret.returning };
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => opts.selectReturns ?? [],
          orderBy: () => ({ limit: async () => opts.selectReturns ?? [] }),
        }),
      }),
    }),
    delete: () => ({ where: () => ({ returning: async () => opts.deleteReturns ?? [] }) }),
  };
  return { db: db as any, captured };
}

const post = (body: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

describe('seamRoutes /ingest/feedback', () => {
  it('creates a feedback candidate (201) scoped to the resolved segment', async () => {
    const { db, captured } = makeDb({ insertReturns: [{ id: 'fb1', status: 'new' }] });
    const res = await createSeamRoutes(db).request('/ingest/feedback', post({ eventId: 'e1', text: 'great product', companyId: 'c1' }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 'fb1', status: 'new', deduped: false });
    expect(captured.insertValues.segmentId).toBe('seg-1');
    expect(captured.insertValues.externalRef).toBe('e1');
  });

  it('is idempotent: a re-delivered eventId returns the existing row (200, deduped)', async () => {
    const { db } = makeDb({ insertReturns: [], selectReturns: [{ id: 'fb1', status: 'triaged' }] });
    const res = await createSeamRoutes(db).request('/ingest/feedback', post({ eventId: 'e1', text: 'again' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'fb1', status: 'triaged', deduped: true });
  });

  it('requires eventId and text', async () => {
    const { db } = makeDb();
    expect((await createSeamRoutes(db).request('/ingest/feedback', post({ text: 'x' }))).status).toBe(400);
    expect((await createSeamRoutes(db).request('/ingest/feedback', post({ eventId: 'e1' }))).status).toBe(400);
  });
});

describe('seamRoutes /webhooks', () => {
  it('rejects a non-https url', async () => {
    const { db } = makeDb();
    const res = await createSeamRoutes(db).request('/webhooks', post({ url: 'http://insecure', events: ['sprint.completed'] }));
    expect(res.status).toBe(400);
  });

  it('rejects when no valid events are supplied', async () => {
    const { db } = makeDb();
    const res = await createSeamRoutes(db).request('/webhooks', post({ url: 'https://host/wh', events: ['bogus'] }));
    expect(res.status).toBe(400);
  });

  it('creates a subscription through the shared use case and returns the secret once', async () => {
    const { db, captured } = makeDb({
      insertReturns: [{
        id: 'sub1', url: 'https://host/wh', events: JSON.stringify(['sprint.completed']),
        active: true, createdAt: new Date('2026-01-01T00:00:00Z'),
      }],
    });
    const res = await createSeamRoutes(db).request('/webhooks', post({ url: 'https://host/wh', events: ['sprint.completed', 'bogus'] }));
    expect(res.status).toBe(201);
    const body = await res.json() as Record<string, unknown>;
    expect(body.id).toBe('sub1');
    expect(body.events).toEqual(['sprint.completed']);
    expect(typeof body.secret).toBe('string');
    // The seam narrows to the resolved segment and, like `/api/v1`, records the key.
    expect(captured.insertValues.segmentId).toBe('seg-1');
    expect(captured.insertValues.tenantId).toBe(1);
    expect(captured.insertValues.createdByKeyId).toBe('k1');
    expect(captured.insertValues.events).toBe(JSON.stringify(['sprint.completed'])); // bogus filtered
  });

  it('applies the SAME secret rule as /api/v1 (one validation, two doors)', async () => {
    const { db } = makeDb();
    const res = await createSeamRoutes(db).request('/webhooks', post({ url: 'https://host/wh', events: ['sprint.completed'], secret: 'short' }));
    expect(res.status).toBe(400);
  });

  it("lists the segment's subscriptions without secrets", async () => {
    const rows = [{ id: 'sub1', url: 'https://host/wh', events: '["sprint.completed"]', active: true, createdAt: '2026-01-01' }];
    const { db } = makeDb({ selectReturns: rows });
    const res = await createSeamRoutes(db).request('/webhooks?companyId=c1');
    expect(res.status).toBe(200);
    const body = await res.json() as { subscriptions: unknown[]; availableEvents: string[] };
    expect(body.subscriptions).toEqual(rows);
    expect(body.availableEvents.length).toBeGreaterThan(0);
  });

  it('DELETE removes an owned subscription', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const { db } = makeDb({ deleteReturns: [{ id }] });
    const res = await createSeamRoutes(db).request(`/webhooks/${id}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, id });
  });

  it('DELETE 404s when no owned subscription matches', async () => {
    const { db } = makeDb({ deleteReturns: [] });
    const res = await createSeamRoutes(db).request('/webhooks/sub-x', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});
