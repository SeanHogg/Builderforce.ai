/**
 * THE INSIGHTS SITE KEY IS PUBLIC — so it must be powerless outside ingest.
 *
 * A `bfr_` key sits in the loader tag on every page of a customer's site; anyone
 * can read it from the page source. These pin the three doors such a key must
 * NOT open (PRD 33 §8 S1/S6 security test):
 *
 *   1. a normal authenticated route (`GET /api/projects`) — the key is not a session;
 *   2. the key → member-session exchange (`/api/auth/tenant-api-key-token`), which
 *      would otherwise mint a full tenant JWT as the site's creator;
 *   3. revoke-by-possession (`/api/auth/keys/revoke`), which would let a stranger
 *      switch a customer's recording off.
 *
 * And the mint itself refuses a `bfr_` key with any scope beyond `replay:ingest`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const mocks = vi.hoisted(() => ({
  mintTenantSessionToken: vi.fn(),
}));

vi.mock('../../infrastructure/auth/tenantSessionToken', () => ({
  mintTenantSessionToken: mocks.mintTenantSessionToken,
}));

import type { HonoEnv } from '../../env';
import { authMiddleware } from '../middleware/authMiddleware';
import { errorHandler } from '../middleware/errorHandler';
import { createAuthRoutes } from './authRoutes';
import {
  keyMayActAsMember,
  mintTenantApiKey,
  revokeTenantApiKeyByRawKey,
} from '../../application/llm/tenantApiKeyService';

const SITE_KEY = 'bfr_0123456789abcdef0123456789abcdef';
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as never;

beforeEach(() => {
  mocks.mintTenantSessionToken.mockReset();
});

describe('a replay:ingest-only key on a normal authenticated route', () => {
  it('is refused by GET /api/projects (it is not a session token)', async () => {
    const app = new Hono<HonoEnv>();
    app.onError(errorHandler as never);
    const handler = vi.fn((c: { json: (v: unknown) => Response }) => c.json({ projects: [] }));
    app.get('/api/projects', authMiddleware, handler as never);

    const res = await app.request(
      '/api/projects',
      { headers: { Authorization: `Bearer ${SITE_KEY}` } },
      { JWT_SECRET: 'test-secret' } as never,
      ctx,
    );

    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('the key → member-session exchange', () => {
  function authApp(row: Record<string, unknown> | null) {
    const chain = { from: () => chain, where: () => chain, limit: async () => (row ? [row] : []) };
    const db = { select: vi.fn(() => chain) };
    const router = createAuthRoutes({} as never, {} as never, db as never);
    router.onError(errorHandler as never);
    return router;
  }

  it('refuses a key scoped to replay:ingest — no tenant JWT is minted', async () => {
    const router = authApp({
      id: 'k1', tenantId: 7, revokedAt: null, createdByUserId: 'u-site-owner',
      client: 'replay', scopes: JSON.stringify(['replay:ingest']),
    });
    const res = await router.request('/tenant-api-key-token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ apiKey: SITE_KEY }),
    }, {} as never, ctx);

    expect(res.status).toBe(401);
    expect(mocks.mintTenantSessionToken).not.toHaveBeenCalled();
  });

  it('only unrestricted keys may act as a member', () => {
    expect(keyMayActAsMember(null)).toBe(true);
    expect(keyMayActAsMember([])).toBe(true);
    expect(keyMayActAsMember(['replay:ingest'])).toBe(false);
    expect(keyMayActAsMember(['read:canvas'])).toBe(false);
  });
});

describe('revoke-by-possession', () => {
  it('cannot revoke a public site key', async () => {
    const update = vi.fn();
    await expect(revokeTenantApiKeyByRawKey({ update } as never, { rawKey: SITE_KEY })).resolves.toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
});

describe('minting a site key', () => {
  const insert = vi.fn();
  const db = { insert } as never;

  it('refuses any scope beyond replay:ingest', async () => {
    await expect(mintTenantApiKey(db, {
      tenantId: 7, name: 'Insights', createdByUserId: 'u1', prefix: 'bfr',
      scopes: ['replay:ingest', 'read:canvas'], allowedOrigins: ['https://shop.example.com'],
    })).rejects.toThrow(/replay:ingest/);
    expect(insert).not.toHaveBeenCalled();
  });

  it('refuses a site key with no origin binding', async () => {
    await expect(mintTenantApiKey(db, {
      tenantId: 7, name: 'Insights', createdByUserId: 'u1', prefix: 'bfr', scopes: ['replay:ingest'],
    })).rejects.toThrow(/origin/);
    expect(insert).not.toHaveBeenCalled();
  });
});
