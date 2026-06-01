import { describe, expect, it, vi } from 'vitest';

const TENANT = 77;
const USER = 'user-abc';
vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set('tenantId', TENANT);
    c.set('userId', USER);
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

const enabledWithConsent = (capabilities: string[]) =>
  JSON.stringify({ embed: { enabled: true, capabilities, consentVersion: 1, consentedAt: '2026-01-01T00:00:00.000Z', consentedBy: USER } });

describe('embedRoutes /config', () => {
  it('GET defaults to disabled + no capabilities + no consent when unset', async () => {
    const { db } = makeDb({ settings: null, isolationMode: 'single' });
    const res = await createEmbedRoutes(db).request('/config');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      enabled: false,
      capabilities: [],
      consentVersion: null,
      consentedAt: null,
      consentedBy: null,
      isolationMode: 'single',
      consentRequiredVersion: 1,
    });
  });

  it('GET reads existing embed config (incl. consent) from tenant settings', async () => {
    const { db } = makeDb({ settings: enabledWithConsent(['product', 'agile']), isolationMode: 'segmented' });
    const res = await createEmbedRoutes(db).request('/config');
    expect(await res.json()).toEqual({
      enabled: true,
      capabilities: ['product', 'agile'],
      consentVersion: 1,
      consentedAt: '2026-01-01T00:00:00.000Z',
      consentedBy: USER,
      isolationMode: 'segmented',
      consentRequiredVersion: 1,
    });
  });

  it('PUT enabling without prior consent and without acknowledgement is rejected (409)', async () => {
    const { db, captured } = makeDb({ settings: null });
    const res = await createEmbedRoutes(db).request('/config', putJson({ enabled: true, capabilities: ['product'] }));
    expect(res.status).toBe(409);
    expect(((await res.json()) as Record<string, unknown>).code).toBe('EMBED_CONSENT_REQUIRED');
    expect(captured.updateSet).toBeUndefined(); // nothing written
  });

  it('PUT enabling with acknowledgement stamps consent version + actor, filters unknown caps, preserves other settings', async () => {
    const { db, captured } = makeDb({ settings: JSON.stringify({ other: 'keep' }) });
    const res = await createEmbedRoutes(db).request('/config', putJson({ enabled: true, capabilities: ['product', 'bogus', 'security'], consentAcknowledged: true }));
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.enabled).toBe(true);
    expect(body.capabilities).toEqual(['product', 'security']);
    expect(body.consentVersion).toBe(1);
    expect(body.consentedBy).toBe(USER);
    expect(typeof body.consentedAt).toBe('string');

    const written = JSON.parse(captured.updateSet.settings);
    expect(written.other).toBe('keep'); // unrelated settings preserved
    expect(written.embed.enabled).toBe(true);
    expect(written.embed.capabilities).toEqual(['product', 'security']);
    expect(written.embed.consentVersion).toBe(1);
    expect(written.embed.consentedBy).toBe(USER);
  });

  it('PUT does not require re-acknowledgement when consent already at current version', async () => {
    const { db, captured } = makeDb({ settings: enabledWithConsent(['product']) });
    // Toggle capabilities while staying enabled; no consentAcknowledged sent.
    const res = await createEmbedRoutes(db).request('/config', putJson({ enabled: true, capabilities: ['product', 'agile'] }));
    expect(res.status).toBe(200);
    const written = JSON.parse(captured.updateSet.settings);
    expect(written.embed.capabilities).toEqual(['product', 'agile']);
    expect(written.embed.consentVersion).toBe(1); // preserved
    expect(written.embed.consentedAt).toBe('2026-01-01T00:00:00.000Z'); // unchanged
  });

  it('PUT disabling never requires consent and preserves the prior consent record', async () => {
    const { db, captured } = makeDb({ settings: enabledWithConsent(['product']) });
    const res = await createEmbedRoutes(db).request('/config', putJson({ enabled: false, capabilities: [] }));
    expect(res.status).toBe(200);
    const written = JSON.parse(captured.updateSet.settings);
    expect(written.embed.enabled).toBe(false);
    expect(written.embed.consentVersion).toBe(1); // audit record kept
  });

  it('PUT coerces a missing enabled to false', async () => {
    const { db } = makeDb({ settings: null });
    const res = await createEmbedRoutes(db).request('/config', putJson({ capabilities: ['agile'] }));
    const body = await res.json() as Record<string, unknown>;
    expect(body.enabled).toBe(false);
    expect(body.capabilities).toEqual(['agile']);
  });
});
