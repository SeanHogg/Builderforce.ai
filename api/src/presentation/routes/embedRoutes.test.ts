import { describe, expect, it, vi } from 'vitest';

const TENANT = 77;
vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set('tenantId', TENANT);
    c.set('role', 'manager');
    await next();
  },
  requireRole: () => async (_c: any, next: any) => next(),
}));

import { createEmbedRoutes } from './embedRoutes';

function makeDb(settingsRow: { settings?: string | null; isolationMode?: string } = {}) {
  const captured: { updateSet?: any } = {};
  const db = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [settingsRow] }) }) }),
    update: () => ({
      set: (s: any) => {
        captured.updateSet = s;
        return { where: async () => undefined };
      },
    }),
  };
  return { db: db as any, captured };
}

const putJson = (body: unknown) => ({
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

describe('embedRoutes /config', () => {
  it('GET defaults to disabled + no capabilities when unset', async () => {
    const { db } = makeDb({ settings: null, isolationMode: 'single' });
    const res = await createEmbedRoutes(db).request('/config');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: false, capabilities: [], isolationMode: 'single' });
  });

  it('GET reads existing embed config from tenant settings', async () => {
    const { db } = makeDb({ settings: JSON.stringify({ embed: { enabled: true, capabilities: ['product', 'agile'] } }), isolationMode: 'segmented' });
    const res = await createEmbedRoutes(db).request('/config');
    expect(await res.json()).toEqual({ enabled: true, capabilities: ['product', 'agile'], isolationMode: 'segmented' });
  });

  it('PUT persists enabled + filters unknown capabilities, preserving other settings', async () => {
    const { db, captured } = makeDb({ settings: JSON.stringify({ other: 'keep' }) });
    const res = await createEmbedRoutes(db).request('/config', putJson({ enabled: true, capabilities: ['product', 'bogus', 'security'] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: true, capabilities: ['product', 'security'] });
    const written = JSON.parse(captured.updateSet.settings);
    expect(written.other).toBe('keep'); // unrelated settings preserved
    expect(written.embed).toEqual({ enabled: true, capabilities: ['product', 'security'] });
  });

  it('PUT coerces a missing enabled to false', async () => {
    const { db } = makeDb({ settings: null });
    const res = await createEmbedRoutes(db).request('/config', putJson({ capabilities: ['agile'] }));
    expect(await res.json()).toEqual({ enabled: false, capabilities: ['agile'] });
  });
});
