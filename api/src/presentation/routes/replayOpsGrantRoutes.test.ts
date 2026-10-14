/**
 * `POST /api/admin/replay-ops/grants` — the operator's credit grant (D17): superadmin
 * only, audited BEFORE the ledger credit, and the ledger reference names the audit
 * row (`replay-grant:<audit id>`). The route runs the real `grantReplayCredits`;
 * the audit writer, the wallet and the tenant read are mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../../env';
import { ForbiddenError } from '../../domain/shared/errors';

const mocks = vi.hoisted(() => ({
  superadmin: true,
  order: [] as string[],
  writeAdminAudit: vi.fn(),
  creditReplayGrant: vi.fn(),
  loadTenantPlanRow: vi.fn(),
  recordReplayTrace: vi.fn(async () => undefined),
  getReplayTenantSettings: vi.fn(),
  updateReplayTenantSettings: vi.fn(),
}));

vi.mock('../middleware/superAdminMiddleware', () => {
  const guard: MiddlewareHandler<HonoEnv> = async (c, next) => {
    if (!mocks.superadmin) throw new ForbiddenError('Superadmin access required');
    c.set('userId', 'op-1');
    await next();
  };
  return { superAdminMiddleware: guard };
});
vi.mock('../../infrastructure/audit/adminAudit', () => ({ writeAdminAudit: mocks.writeAdminAudit }));
vi.mock('../../application/tenant/tenantPlanSnapshot', () => ({ loadTenantPlanRow: mocks.loadTenantPlanRow }));
vi.mock('../../application/replay/replayTrace', () => ({
  recordReplayTrace: mocks.recordReplayTrace,
  REPLAY_TRACE_VERBS: { creditsAdded: 'replay.credits.added' },
}));
vi.mock('../../application/commerce/replayWallet', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../application/commerce/replayWallet')>();
  return {
    ...real,
    creditReplayGrant: mocks.creditReplayGrant,
    replayWalletSnapshot: vi.fn(async () => ({ credits: 250_000, freeUsed: 0, freeRemaining: 5_000, period: '2026-10' })),
  };
});

vi.mock('../../application/replay/replayTenantSettings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../application/replay/replayTenantSettings')>()),
  getReplayTenantSettings: mocks.getReplayTenantSettings,
  updateReplayTenantSettings: mocks.updateReplayTenantSettings,
}));

import { errorHandler } from '../middleware/errorHandler';
import { createReplayOpsGrantRoutes } from './replayOpsGrantRoutes';

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as never;
const db = {} as never;

function grant(body: unknown) {
  const router = createReplayOpsGrantRoutes(db);
  router.onError(errorHandler as never);
  return router.request('/grants', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' },
    body: JSON.stringify(body),
  }, {} as never, ctx);
}

beforeEach(() => {
  mocks.superadmin = true;
  mocks.order = [];
  mocks.writeAdminAudit.mockReset().mockImplementation(async () => { mocks.order.push('audit'); });
  mocks.creditReplayGrant.mockReset().mockImplementation(async () => { mocks.order.push('ledger'); return true; });
  mocks.loadTenantPlanRow.mockReset().mockResolvedValue({ id: 1 });
  mocks.recordReplayTrace.mockClear();
  mocks.getReplayTenantSettings.mockReset().mockResolvedValue({ replayExcluded: false, replayFreeAllowanceOverride: null });
  mocks.updateReplayTenantSettings.mockReset().mockImplementation(async (_db: unknown, _env: unknown, input: { patch: Record<string, unknown> }) => ({
    replayExcluded: false, replayFreeAllowanceOverride: null, ...input.patch,
  }));
});

function settings(method: 'GET' | 'PATCH', tenantId: string, body?: unknown) {
  const router = createReplayOpsGrantRoutes(db);
  router.onError(errorHandler as never);
  return router.request(`/tenants/${tenantId}/settings`, {
    method,
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, {} as never, ctx);
}

describe('POST /grants', () => {
  it('audits REPLAY_CREDITS_GRANTED, then credits the ledger under replay-grant:<audit id>', async () => {
    const res = await grant({ tenantId: 1, units: 250_000, reason: 'Customer #1 — dogfood allowance' });
    expect(res.status).toBe(201);

    expect(mocks.order).toEqual(['audit', 'ledger']);
    const [, event, actorId, opts] = mocks.writeAdminAudit.mock.calls[0] as [unknown, string, string, { id: string; tenantId: number; metadata: Record<string, unknown>; ipAddress: string }];
    expect(event).toBe('REPLAY_CREDITS_GRANTED');
    expect(actorId).toBe('op-1');
    expect(opts).toMatchObject({ tenantId: 1, ipAddress: '203.0.113.9', metadata: { units: 250_000 } });
    expect(opts.id).toMatch(/^[0-9a-f-]{36}$/);

    expect(mocks.creditReplayGrant).toHaveBeenCalledWith(db, {}, expect.objectContaining({
      tenantId: 1, units: 250_000, auditId: opts.id, actorId: 'op-1',
    }));
    expect(await res.json()).toEqual({
      auditId: opts.id, reference: `replay-grant:${opts.id}`, units: 250_000, credits: 250_000,
    });
  });

  it('refuses a caller who is not a superadmin, writing nothing', async () => {
    mocks.superadmin = false;
    expect((await grant({ tenantId: 1, units: 10, reason: 'please' })).status).toBe(403);
    expect(mocks.writeAdminAudit).not.toHaveBeenCalled();
    expect(mocks.creditReplayGrant).not.toHaveBeenCalled();
  });

  it('404s an unknown workspace before any audit row', async () => {
    mocks.loadTenantPlanRow.mockResolvedValue(null);
    expect((await grant({ tenantId: 999, units: 10, reason: 'please' })).status).toBe(404);
    expect(mocks.writeAdminAudit).not.toHaveBeenCalled();
  });

  it('400s a malformed or oversized grant', async () => {
    expect((await grant({ tenantId: 1, units: 0, reason: 'zero' })).status).toBe(400);
    expect((await grant({ tenantId: 1, units: 5_000_000, reason: 'too many' })).status).toBe(400);
    expect((await grant({ tenantId: 1, units: 10 })).status).toBe(400);
    expect(mocks.creditReplayGrant).not.toHaveBeenCalled();
  });

  it('does not credit when the audit write fails', async () => {
    mocks.writeAdminAudit.mockRejectedValue(new Error('audit down'));
    expect((await grant({ tenantId: 1, units: 10, reason: 'please' })).status).toBe(500);
    expect(mocks.creditReplayGrant).not.toHaveBeenCalled();
  });
});

describe('/tenants/:tenantId/settings', () => {
  it('GET returns the workspace switches', async () => {
    mocks.getReplayTenantSettings.mockResolvedValue({ replayExcluded: true, replayFreeAllowanceOverride: 0 });
    const res = await settings('GET', '7');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ replayExcluded: true, replayFreeAllowanceOverride: 0 });
    expect(mocks.getReplayTenantSettings).toHaveBeenCalledWith(db, 7);
  });

  it('PATCH passes the operator, workspace and patch to the audited write', async () => {
    const res = await settings('PATCH', '7', { replayFreeAllowanceOverride: 0 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ replayExcluded: false, replayFreeAllowanceOverride: 0 });
    expect(mocks.updateReplayTenantSettings).toHaveBeenCalledWith(db, {}, {
      actorId: 'op-1', tenantId: 7, patch: { replayFreeAllowanceOverride: 0 }, ipAddress: '203.0.113.9',
    });
  });

  it('PATCH accepts null to clear the override', async () => {
    expect((await settings('PATCH', '7', { replayFreeAllowanceOverride: null })).status).toBe(200);
    expect(mocks.updateReplayTenantSettings).toHaveBeenCalledWith(db, {}, expect.objectContaining({
      patch: { replayFreeAllowanceOverride: null },
    }));
  });

  it('refuses a caller who is not a superadmin, reading and writing nothing', async () => {
    mocks.superadmin = false;
    expect((await settings('GET', '7')).status).toBe(403);
    expect((await settings('PATCH', '7', { replayExcluded: true })).status).toBe(403);
    expect(mocks.getReplayTenantSettings).not.toHaveBeenCalled();
    expect(mocks.updateReplayTenantSettings).not.toHaveBeenCalled();
  });

  it('400s a negative, fractional or empty patch before any write', async () => {
    expect((await settings('PATCH', '7', { replayFreeAllowanceOverride: -1 })).status).toBe(400);
    expect((await settings('PATCH', '7', { replayFreeAllowanceOverride: 2.5 })).status).toBe(400);
    expect((await settings('PATCH', '7', { replayExcluded: 'yes' })).status).toBe(400);
    expect((await settings('PATCH', '7', {})).status).toBe(400);
    expect(mocks.updateReplayTenantSettings).not.toHaveBeenCalled();
  });
});
