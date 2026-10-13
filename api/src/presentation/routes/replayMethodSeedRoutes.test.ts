/**
 * `POST /api/admin/replay-ops/sites/:siteId/seed-method-funnel` (PRD 33 §5.3.6):
 * superadmin only, idempotent, audited. The real `seedMethodFunnel` runs against a
 * fake db; the guard, the audit writer and the site read are mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../../env';
import { ForbiddenError } from '../../domain/shared/errors';
import { fakeDb, type FakeDb } from '../../../test/fakeDb';

const SITE = '11111111-1111-4111-8111-111111111111';

const mocks = vi.hoisted(() => ({
  superadmin: true,
  writeAdminAudit: vi.fn(async () => undefined),
  getSite: vi.fn(),
  db: null as unknown,
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
vi.mock('../../application/replay/replaySites', () => ({ getSite: mocks.getSite }));

import { errorHandler } from '../middleware/errorHandler';
import { createReplayMethodSeedRoutes } from './replayMethodSeedRoutes';
import { METHOD_ACTS, METHOD_FUNNEL_STEPS, METHOD_FUNNEL_WINDOW_MINUTES } from '../../application/replay/replayMethodFunnel';

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as never;

function seed(db: FakeDb, siteId = SITE) {
  const router = createReplayMethodSeedRoutes(db as never);
  router.onError(errorHandler as never);
  return router.request(`/sites/${siteId}/seed-method-funnel`, { method: 'POST' }, {} as never, ctx);
}

beforeEach(() => {
  mocks.superadmin = true;
  mocks.writeAdminAudit.mockClear();
  mocks.getSite.mockReset().mockResolvedValue({ id: SITE, tenantId: 1, kind: 'external', projectId: null });
});

describe('POST /sites/:siteId/seed-method-funnel', () => {
  it('creates the four custom smart events and "The method" funnel, audited', async () => {
    const db = fakeDb([
      METHOD_ACTS.map((name) => ({ name })), // smart events inserted
      [], // no funnel yet
      [{ id: 'funnel-1' }], // funnel inserted
      [], // steps inserted
    ]);
    const res = await seed(db);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ siteId: SITE, funnelId: 'funnel-1', createdSmartEvents: [...METHOD_ACTS], createdFunnel: true });

    const inserts = db.calls.filter((c) => c.kind === 'insert');
    expect(inserts[0]!.payload).toEqual(METHOD_ACTS.map((act) => expect.objectContaining({ name: act, ruleKind: 'custom', match: act, matchMode: 'equals' })));
    expect(inserts[0]!.chain).toContain('onConflictDoNothing');
    expect(inserts[1]!.payload).toMatchObject({ name: 'The method', windowMinutes: METHOD_FUNNEL_WINDOW_MINUTES });
    expect(METHOD_FUNNEL_WINDOW_MINUTES).toBe(43_200);
    expect((inserts[2]!.payload as Array<{ match: string }>).map((s) => s.match)).toEqual(['/', 'composer.submit', ...METHOD_ACTS]);
    expect(METHOD_FUNNEL_STEPS[0]).toEqual({ stepKind: 'page', match: '/', matchMode: 'prefix' });
    expect(mocks.writeAdminAudit).toHaveBeenCalledWith(db, 'REPLAY_METHOD_FUNNEL_SEEDED', 'op-1', expect.objectContaining({ tenantId: 1 }));
  });

  it('is idempotent: a re-run creates nothing, answers 200 and writes no audit row', async () => {
    const db = fakeDb([
      [], // every smart event already existed
      [{ id: 'funnel-1' }], // the funnel already exists
    ]);
    const res = await seed(db);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ siteId: SITE, funnelId: 'funnel-1', createdSmartEvents: [], createdFunnel: false });
    expect(db.calls.filter((c) => c.kind === 'insert')).toHaveLength(1);
    expect(mocks.writeAdminAudit).not.toHaveBeenCalled();
  });

  it('refuses a caller who is not a superadmin, touching nothing', async () => {
    mocks.superadmin = false;
    const db = fakeDb([]);
    expect((await seed(db)).status).toBe(403);
    expect(db.calls).toHaveLength(0);
  });

  it('404s an unknown site and 400s a malformed id', async () => {
    mocks.getSite.mockResolvedValue(null);
    expect((await seed(fakeDb([]))).status).toBe(404);
    expect((await seed(fakeDb([]), 'not-a-uuid')).status).toBe(400);
  });
});
