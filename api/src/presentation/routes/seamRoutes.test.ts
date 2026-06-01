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
          orderBy: async () => opts.selectReturns ?? [],
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

  it('creates a subscription and returns the secret once', async () => {
    const { db, captured } = makeDb({ insertReturns: [{ id: 'sub1', createdAt: '2026-01-01' }] });
    const res = await createSeamRoutes(db).request('/webhooks', post({ url: 'https://host/wh', events: ['sprint.completed', 'bogus'] }));
    expect(res.status).toBe(201);
    const body = await res.json() as Record<string, unknown>;
    expect(body.id).toBe('sub1');
    expect(body.events).toEqual(['sprint.completed']); // bogus filtered
    expect(typeof body.secret).toBe('string');
    expect(captured.insertValues.segmentId).toBe('seg-1');
  });

  it('DELETE 404s when no owned subscription matches', async () => {
    const { db } = makeDb({ deleteReturns: [] });
    const res = await createSeamRoutes(db).request('/webhooks/sub-x', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});
