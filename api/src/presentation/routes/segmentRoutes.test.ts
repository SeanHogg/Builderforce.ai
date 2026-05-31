import { describe, expect, it, vi } from 'vitest';

// Bypass real auth: inject a fixed tenant context; let role gates pass.
const TENANT = 4242;
vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set('tenantId', TENANT);
    c.set('segmentId', 'seg-default');
    c.set('role', 'manager');
    await next();
  },
  requireRole: () => async (_c: any, next: any) => next(),
}));

import { createSegmentRoutes } from './segmentRoutes';

/**
 * Chainable Drizzle mock that captures the values/sets the route passes, and
 * returns canned rows. We assert on the captured payloads because the
 * security-relevant decisions live there (tenant stamping, no isolation_mode
 * escalation, default-segment protection).
 */
function makeDb(opts: { selectRows?: unknown[]; insertRows?: unknown[]; updateRows?: unknown[] } = {}) {
  const captured: { insertValues?: any; updateSet?: any } = {};
  const db = {
    select: () => ({ from: () => ({ where: () => ({ orderBy: async () => opts.selectRows ?? [] }) }) }),
    insert: () => ({
      values: (v: any) => {
        captured.insertValues = v;
        return { returning: async () => opts.insertRows ?? [{ id: 'seg-new', ...v }] };
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

const json = (body: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

describe('segmentRoutes', () => {
  it('GET / lists the tenant segments', async () => {
    const rows = [{ id: 'seg-default', isDefault: true }, { id: 'seg-acme', isDefault: false }];
    const { db } = makeDb({ selectRows: rows });
    const res = await createSegmentRoutes(db).request('/');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(rows);
  });

  it('POST / stamps the tenant, derives the slug, and never sets isDefault or isolation escalation', async () => {
    const { db, captured } = makeDb({ insertRows: [{ id: 'seg-new' }] });
    const res = await createSegmentRoutes(db).request('/', json({ displayName: 'Acme Co', externalAccountId: 'a1', externalCompanyId: 'c1' }));
    expect(res.status).toBe(201);
    // Security-relevant: provisioning is tenant-stamped, is NOT the default, and
    // does NOT flip the tenant to 'segmented' (that would break un-threaded writes).
    expect(captured.insertValues.tenantId).toBe(TENANT);
    expect(captured.insertValues.isDefault).toBe(false);
    expect(captured.insertValues.slug).toBe('acme-co');
    expect('isolationMode' in captured.insertValues).toBe(false);
  });

  it('POST / requires a displayName', async () => {
    const { db } = makeDb();
    const res = await createSegmentRoutes(db).request('/', json({ externalAccountId: 'a1' }));
    expect(res.status).toBe(400);
  });

  it('PATCH /:id 404s when no owned, non-default row matches (tenant + default guard)', async () => {
    const { db } = makeDb({ updateRows: [] }); // where(tenantId, !isDefault) matched nothing
    const res = await createSegmentRoutes(db).request('/seg-x', { ...json({ status: 'suspended' }), method: 'PATCH' });
    expect(res.status).toBe(404);
  });

  it('PATCH /:id applies a valid status change', async () => {
    const { db, captured } = makeDb({ updateRows: [{ id: 'seg-acme', status: 'suspended' }] });
    const res = await createSegmentRoutes(db).request('/seg-acme', { ...json({ status: 'suspended' }), method: 'PATCH' });
    expect(res.status).toBe(200);
    expect(captured.updateSet.status).toBe('suspended');
  });

  it('PATCH /:id rejects an invalid status', async () => {
    const { db } = makeDb();
    const res = await createSegmentRoutes(db).request('/seg-acme', { ...json({ status: 'nonsense' }), method: 'PATCH' });
    expect(res.status).toBe(400);
  });
});
