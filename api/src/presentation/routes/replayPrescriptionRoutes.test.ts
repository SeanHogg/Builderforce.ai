/**
 * `/api/replay/prescriptions*` and `/api/replay/releases/:key/report`: the Insights
 * gate, the `?site=` rule (D17), MANAGER on actions and "Find fixes now", the
 * hourly limit's 429, and the filter/area passed through. Services are mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The gate's proof-site clause: no workspace here reads its own live proof site.
vi.mock('../../application/replay/proofSiteRead', () => ({ readsOwnProofSite: async () => false }));
import type { MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../../env';
import { ForbiddenError } from '../../domain/shared/errors';

const OWN_SITE = '11111111-2222-4333-8444-555555555555';
const OTHER_SITE = '99999999-2222-4333-8444-555555555555';
const RX = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

const mocks = vi.hoisted(() => ({
  entitled: true,
  getSiteForTenant: vi.fn(),
  listPrescriptions: vi.fn(async () => []),
  getPrescription: vi.fn(async () => ({ id: 'rx' })),
  releaseReport: vi.fn(async () => ({ releaseKey: 'r1', label: null, firstSeenAt: null, prescriptions: [] })),
  sweepNow: vi.fn(async () => ({ found: 1, created: 1, refreshed: 0, prescribed: 0 })),
  runPrescriptionAction: vi.fn(async () => ({ prescription: { id: 'rx' } })),
  verifyOnRead: vi.fn(async () => {}),
}));

vi.mock('../middleware/authMiddleware', async (importOriginal) => {
  const real = await importOriginal<typeof import('../middleware/authMiddleware')>();
  const fakeAuth: MiddlewareHandler<HonoEnv> = async (c, next) => {
    c.set('tenantId', Number(c.req.header('x-tenant') ?? 7));
    c.set('userId', 'u1');
    c.set('role', (c.req.header('x-role') ?? 'manager') as never);
    c.set('db', {} as never);
    await next();
  };
  return { ...real, authMiddleware: fakeAuth };
});
vi.mock('../../application/tenant/featureEntitlements', () => ({
  resolveFeatureEntitlement: vi.fn(async (_env: unknown, _t: number, _u: unknown, feature: string) => ({
    entitled: mocks.entitled, reason: mocks.entitled ? 'capability' : 'not_entitled', feature,
    label: 'Insights', currentPlan: 'free', requiredPlan: 'teams', capability: 'session-replay',
  })),
  tenantHasFeature: vi.fn(),
  toTenantPlan: vi.fn(),
}));
vi.mock('../../application/replay/replaySites', () => ({ getSiteForTenant: mocks.getSiteForTenant }));
vi.mock('../../application/shared/dbHandle', () => ({ requestDb: (c: { get(key: 'db'): unknown }) => c.get('db') ?? {} }));
vi.mock('../../application/replay/prescriptionReads', () => ({
  listPrescriptions: mocks.listPrescriptions, getPrescription: mocks.getPrescription, releaseReport: mocks.releaseReport,
}));
vi.mock('../../application/replay/prescriptionSweep', async () => {
  const { DomainError } = await import('../../domain/shared/errors');
  class PrescriptionSweepLimitError extends DomainError { readonly status = 429; }
  return { sweepNow: mocks.sweepNow, PrescriptionSweepLimitError };
});
vi.mock('../../application/replay/prescriptionActions', () => ({ runPrescriptionAction: mocks.runPrescriptionAction }));
vi.mock('../../application/replay/prescriptionVerify', () => ({ verifyOnRead: mocks.verifyOnRead }));

import { errorHandler } from '../middleware/errorHandler';
import { PrescriptionSweepLimitError } from '../../application/replay/prescriptionSweep';
import { createReplayPrescriptionRoutes } from './replayPrescriptionRoutes';

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as never;

function call(path: string, init: RequestInit & { tenant?: number; role?: string } = {}) {
  const router = createReplayPrescriptionRoutes();
  router.onError(errorHandler as never);
  const headers = new Headers(init.headers);
  if (init.tenant) headers.set('x-tenant', String(init.tenant));
  if (init.role) headers.set('x-role', init.role);
  if (init.body) headers.set('content-type', 'application/json');
  return router.request(path, { ...init, headers }, {} as never, ctx);
}

const SCOPE = { tenantId: 7, siteId: OWN_SITE };

beforeEach(() => {
  mocks.entitled = true;
  mocks.getSiteForTenant.mockReset();
  mocks.getSiteForTenant.mockImplementation(async (_env: unknown, _db: unknown, tenantId: number, siteId: string) => {
    if (tenantId !== 7 || siteId !== OWN_SITE) throw new ForbiddenError('That Insights site is not in this workspace');
    return { id: siteId, tenantId };
  });
  for (const fn of [mocks.listPrescriptions, mocks.getPrescription, mocks.releaseReport, mocks.sweepNow, mocks.runPrescriptionAction, mocks.verifyOnRead]) fn.mockClear();
});

describe('reads', () => {
  it('lists the site\'s fixes with the area, status and URL filter, and 403s another workspace\'s site', async () => {
    expect((await call(`/prescriptions?site=${OWN_SITE}&area=ux&f.visitedPath.prefix=/checkout`)).status).toBe(200);
    expect(mocks.listPrescriptions).toHaveBeenCalledWith({}, {}, SCOPE, {
      area: 'ux', status: null, filter: { all: [{ field: 'visitedPath', op: 'prefix', value: '/checkout' }] },
    });
    expect((await call(`/prescriptions?site=${OTHER_SITE}`)).status).toBe(403);
    expect((await call(`/prescriptions?site=${OWN_SITE}`, { tenant: 8 })).status).toBe(403);
  });

  it('verifies one fix on read before answering it', async () => {
    expect((await call(`/prescriptions/${RX}?site=${OWN_SITE}`)).status).toBe(200);
    expect(mocks.verifyOnRead).toHaveBeenCalledWith({}, {}, SCOPE, RX);
    expect(mocks.getPrescription).toHaveBeenCalledWith({}, {}, SCOPE, RX);
  });

  it('answers a release\'s improvement ledger', async () => {
    expect((await call(`/releases/r1/report?site=${OWN_SITE}`)).status).toBe(200);
    expect(mocks.releaseReport).toHaveBeenCalledWith({}, {}, SCOPE, 'r1');
  });

  it('is behind the Insights gate', async () => {
    mocks.entitled = false;
    expect((await call(`/prescriptions?site=${OWN_SITE}`)).status).toBe(403);
    expect(mocks.getSiteForTenant).not.toHaveBeenCalled();
  });
});

describe('actions', () => {
  it('needs MANAGER, passes the body and the actor', async () => {
    const body = JSON.stringify({ reason: 'Seasonal' });
    expect((await call(`/prescriptions/${RX}/dismiss?site=${OWN_SITE}`, { method: 'POST', body, role: 'developer' })).status).toBe(403);
    expect(mocks.runPrescriptionAction).not.toHaveBeenCalled();
    expect((await call(`/prescriptions/${RX}/dismiss?site=${OWN_SITE}`, { method: 'POST', body })).status).toBe(200);
    expect(mocks.runPrescriptionAction).toHaveBeenCalledWith({}, {}, SCOPE, RX, 'dismiss', { reason: 'Seasonal' }, { actorId: 'u1' });
  });

  it('404s an action that does not exist, and 400s a malformed body', async () => {
    expect((await call(`/prescriptions/${RX}/launch?site=${OWN_SITE}`, { method: 'POST' })).status).toBe(404);
    expect((await call(`/prescriptions/${RX}/fix?site=${OWN_SITE}`, { method: 'POST', body: JSON.stringify({ projectId: 'five' }) })).status).toBe(400);
    expect(mocks.runPrescriptionAction).not.toHaveBeenCalled();
  });
});

describe('Find fixes now', () => {
  it('needs MANAGER and answers 429 inside the hour', async () => {
    expect((await call(`/prescriptions/sweep?site=${OWN_SITE}`, { method: 'POST', role: 'developer' })).status).toBe(403);
    expect((await call(`/prescriptions/sweep?site=${OWN_SITE}`, { method: 'POST' })).status).toBe(200);
    expect(mocks.sweepNow).toHaveBeenCalledWith({}, {}, SCOPE);
    mocks.sweepNow.mockRejectedValueOnce(new PrescriptionSweepLimitError());
    expect((await call(`/prescriptions/sweep?site=${OWN_SITE}`, { method: 'POST' })).status).toBe(429);
  });
});
