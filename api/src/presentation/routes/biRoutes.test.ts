import { describe, expect, it, vi } from 'vitest';

const TENANT = 5;
vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set('tenantId', TENANT);
    c.set('segmentId', 'seg-1');
    c.set('role', 'manager');
    await next();
  },
  requireRole: () => async (_c: any, next: any) => next(),
}));
// Keep the burn-rate / engagements services out of the picture for the config tests.
vi.mock('../../application/seams/burnRateService', () => ({
  fetchBurnRate: async () => ({ available: false, reason: 'not_configured' }),
}));
vi.mock('../../application/seams/validationEngagementsService', () => ({
  fetchValidationEngagements: async () => ({ available: false, reason: 'not_configured' }),
}));

import { createBiRoutes } from './biRoutes';

function makeDb(settings: string | null) {
  const captured: { updateSet?: any } = {};
  const db = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ settings }] }) }) }),
    update: () => ({
      set: (s: any) => {
        captured.updateSet = s;
        return { where: async () => undefined };
      },
    }),
  };
  return { db: db as any, captured };
}

const putJson = (body: unknown) => ({ method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('biRoutes host-BI config', () => {
  it('GET /config reports hasToken WITHOUT ever returning the token', async () => {
    const { db } = makeDb(JSON.stringify({ hostBi: { baseUrl: 'https://host.example', token: 'secret-tok' } }));
    const res = await createBiRoutes(db).request('/config');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ baseUrl: 'https://host.example', hasToken: true });
    expect(JSON.stringify(body)).not.toContain('secret-tok');
  });

  it('GET /config returns no config when unset', async () => {
    const { db } = makeDb(null);
    const res = await createBiRoutes(db).request('/config');
    expect(await res.json()).toEqual({ baseUrl: null, hasToken: false });
  });

  it('PUT /config rejects a non-https base URL', async () => {
    const { db } = makeDb(null);
    const res = await createBiRoutes(db).request('/config', putJson({ baseUrl: 'http://host.example', token: 't' }));
    expect(res.status).toBe(400);
  });

  it('PUT /config requires a token on first configuration', async () => {
    const { db } = makeDb(null);
    const res = await createBiRoutes(db).request('/config', putJson({ baseUrl: 'https://host.example' }));
    expect(res.status).toBe(400);
  });

  it('PUT /config sets baseUrl + token, strips trailing slash, never echoes the token', async () => {
    const { db, captured } = makeDb(null);
    const res = await createBiRoutes(db).request('/config', putJson({ baseUrl: 'https://host.example/', token: 'tok-1' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ baseUrl: 'https://host.example', hasToken: true });
    const written = JSON.parse(captured.updateSet.settings);
    expect(written.hostBi).toEqual({ baseUrl: 'https://host.example', token: 'tok-1' });
  });

  it('PUT /config keeps the existing token on a baseUrl-only rotation', async () => {
    const { db, captured } = makeDb(JSON.stringify({ hostBi: { baseUrl: 'https://old.example', token: 'keep-me' } }));
    const res = await createBiRoutes(db).request('/config', putJson({ baseUrl: 'https://new.example' }));
    expect(res.status).toBe(200);
    const written = JSON.parse(captured.updateSet.settings);
    expect(written.hostBi).toEqual({ baseUrl: 'https://new.example', token: 'keep-me' });
  });

  it('DELETE /config clears the config', async () => {
    const { db, captured } = makeDb(JSON.stringify({ hostBi: { baseUrl: 'https://host.example', token: 't' }, other: 1 }));
    const res = await createBiRoutes(db).request('/config', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const written = JSON.parse(captured.updateSet.settings);
    expect(written.hostBi).toBeUndefined();
    expect(written.other).toBe(1); // preserves other settings
  });
});
