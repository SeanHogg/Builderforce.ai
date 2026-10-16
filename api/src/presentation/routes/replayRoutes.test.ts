/**
 * `/api/replay/*` — the Insights gate, the D17 rule that `?site=` is only ever the
 * caller's own workspace's, and the `replay.session.viewed` trace. Auth is a
 * header-driven stand-in; `requireFeature` is the real gate over a mocked verdict;
 * the read service, the site lookup and the trace writer are mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The gate's proof-site clause: no workspace here reads its own live proof site.
vi.mock('../../application/replay/proofSiteRead', () => ({ readsOwnProofSite: async () => false }));
import type { MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../../env';
import { ForbiddenError } from '../../domain/shared/errors';

const OWN_SITE = '11111111-2222-4333-8444-555555555555';
const OTHER_SITE = '99999999-2222-4333-8444-555555555555';
const REC = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

const mocks = vi.hoisted(() => ({
  entitled: true,
  read: {
    listRecordings: vi.fn(),
    getRecording: vi.fn(),
    chunk: vi.fn(),
    releases: vi.fn(),
    renameRelease: vi.fn(),
    kpis: vi.fn(),
    issues: vi.fn(),
    issue: vi.fn(),
    live: vi.fn(),
  },
  getSiteForTenant: vi.fn(),
  recordReplayTrace: vi.fn(async () => {}),
  usageSnapshot: vi.fn(),
  eraseReplayVisitor: vi.fn(),
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
  resolveFeatureEntitlement: vi.fn(async (_env: unknown, _tenantId: number, _userId: unknown, feature: string) => ({
    entitled: mocks.entitled,
    reason: mocks.entitled ? 'capability' : 'not_entitled',
    feature,
    label: 'Insights',
    currentPlan: 'free',
    requiredPlan: 'teams',
    capability: 'session-replay',
  })),
  tenantHasFeature: vi.fn(),
  toTenantPlan: vi.fn(),
}));
vi.mock('../../application/replay/ReplayReadService', () => ({
  // A constructor mock: `new ReplayReadService(...)` returns the shared stub.
  ReplayReadService: vi.fn(function ReplayReadService() { return mocks.read; }),
}));
vi.mock('../../application/replay/replaySites', () => ({ getSiteForTenant: mocks.getSiteForTenant }));
vi.mock('../../application/replay/replayTrace', () => ({
  recordReplayTrace: mocks.recordReplayTrace,
  REPLAY_TRACE_VERBS: { sessionViewed: 'replay.session.viewed', releaseRenamed: 'replay.release.renamed', visitorErased: 'replay.visitor.erased' },
}));
vi.mock('../../application/replay/replayUsage', () => ({ usageSnapshot: mocks.usageSnapshot }));
vi.mock('../../application/replay/replayVisitorEraser', () => ({ eraseReplayVisitor: mocks.eraseReplayVisitor }));

import { errorHandler } from '../middleware/errorHandler';
import { createReplayRoutes } from './replayRoutes';

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as never;

function call(path: string, init: RequestInit & { tenant?: number } = {}) {
  const router = createReplayRoutes();
  router.onError(errorHandler as never);
  const headers = new Headers(init.headers);
  if (init.tenant) headers.set('x-tenant', String(init.tenant));
  if (init.body) headers.set('content-type', 'application/json');
  return router.request(path, { ...init, headers }, {} as never, ctx);
}

beforeEach(() => {
  mocks.entitled = true;
  for (const fn of Object.values(mocks.read)) fn.mockReset();
  mocks.recordReplayTrace.mockClear();
  mocks.usageSnapshot.mockReset();
  mocks.eraseReplayVisitor.mockReset();
  mocks.getSiteForTenant.mockReset();
  // The application rule: only workspace 7 owns OWN_SITE; anything else is one 403.
  mocks.getSiteForTenant.mockImplementation(async (_env: unknown, _db: unknown, tenantId: number, siteId: string) => {
    if (tenantId !== 7 || siteId !== OWN_SITE) throw new ForbiddenError('That Insights site is not in this workspace');
    return { id: siteId, tenantId };
  });
});

describe('scope (D17)', () => {
  it('reads with the caller workspace and its own site', async () => {
    mocks.read.listRecordings.mockResolvedValue({ items: [], nextCursor: null });
    const res = await call(`/recordings?site=${OWN_SITE}&days=7&f.device.eq=phone`);
    expect(res.status).toBe(200);
    expect(mocks.read.listRecordings).toHaveBeenCalledWith(
      { tenantId: 7, siteId: OWN_SITE },
      expect.objectContaining({ days: 7, filter: { all: [{ field: 'device', op: 'eq', value: 'phone' }] } }),
    );
  });

  it('answers 403 for another workspace’s site and reads nothing', async () => {
    const res = await call(`/recordings?site=${OTHER_SITE}`);
    expect(res.status).toBe(403);
    expect(mocks.read.listRecordings).not.toHaveBeenCalled();
  });

  it('answers 403 when a member of another workspace names this site', async () => {
    const res = await call(`/kpis?site=${OWN_SITE}`, { tenant: 8 });
    expect(res.status).toBe(403);
    expect(mocks.read.kpis).not.toHaveBeenCalled();
  });

  it('answers 400 without a site', async () => {
    const res = await call('/issues');
    expect(res.status).toBe(400);
  });
});

describe('the Insights gate', () => {
  it('answers 403 capability_required when Insights is not installed', async () => {
    mocks.entitled = false;
    const res = await call(`/live?site=${OWN_SITE}`);
    expect(res.status).toBe(403);
    expect(mocks.read.live).not.toHaveBeenCalled();
    expect(mocks.getSiteForTenant).not.toHaveBeenCalled();
  });
});

describe('GET /recordings/:id', () => {
  it('writes replay.session.viewed once per GET', async () => {
    mocks.read.getRecording.mockResolvedValue({ id: REC, marks: [] });
    await call(`/recordings/${REC}?site=${OWN_SITE}`);
    await call(`/recordings/${REC}?site=${OWN_SITE}`);
    expect(mocks.recordReplayTrace).toHaveBeenCalledTimes(2);
    expect(mocks.recordReplayTrace).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      tenantId: 7, siteId: OWN_SITE, verb: 'replay.session.viewed', actorId: 'u1', metadata: { recordingId: REC },
    });
  });

  it('does not trace a refused read', async () => {
    await call(`/recordings/${REC}?site=${OTHER_SITE}`);
    expect(mocks.recordReplayTrace).not.toHaveBeenCalled();
  });
});

describe('GET /recordings/:id/chunks/:seq', () => {
  it('serves the stored bytes as immutable', async () => {
    mocks.read.chunk.mockResolvedValue(new Uint8Array([0x1f, 0x8b, 1]).buffer);
    const res = await call(`/recordings/${REC}/chunks/3?site=${OWN_SITE}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect(new Uint8Array(await res.arrayBuffer())[0]).toBe(0x1f);
    expect(mocks.read.chunk).toHaveBeenCalledWith({ tenantId: 7, siteId: OWN_SITE }, REC, 3);
  });

  it('refuses a negative seq', async () => {
    const res = await call(`/recordings/${REC}/chunks/-1?site=${OWN_SITE}`);
    expect(res.status).toBe(400);
  });
});

describe('releases', () => {
  it('returns a bare array', async () => {
    mocks.read.releases.mockResolvedValue([{ releaseKey: 'abc', ordinal: 1 }]);
    const res = await call(`/releases?site=${OWN_SITE}`);
    expect(await res.json()).toEqual([{ releaseKey: 'abc', ordinal: 1 }]);
  });

  it('renames a release and traces replay.release.renamed', async () => {
    mocks.read.renameRelease.mockResolvedValue({ releaseKey: 'abc', label: 'Spring' });
    const res = await call(`/releases/abc?site=${OWN_SITE}`, { method: 'PATCH', body: JSON.stringify({ label: 'Spring' }) });
    expect(res.status).toBe(200);
    expect(mocks.read.renameRelease).toHaveBeenCalledWith({ tenantId: 7, siteId: OWN_SITE }, 'abc', 'Spring');
    expect(mocks.recordReplayTrace).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ verb: 'replay.release.renamed' }));
  });

  it('needs MANAGER to rename a release', async () => {
    const res = await call(`/releases/abc?site=${OWN_SITE}`, {
      method: 'PATCH', body: JSON.stringify({ label: 'Spring' }), headers: { 'x-role': 'developer' },
    });
    expect(res.status).toBe(403);
    expect(mocks.read.renameRelease).not.toHaveBeenCalled();
  });
});

describe('the filter reaches the KPIs and the issues (≈ under a filter)', () => {
  const PHONES = { all: [{ field: 'device', op: 'eq', value: 'phone' }] };

  it('parses f.* into the KPI read', async () => {
    mocks.read.kpis.mockResolvedValue({ sessions: 4, estimated: true });
    const res = await call(`/kpis?site=${OWN_SITE}&days=7&release=r2&f.device.eq=phone`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ estimated: true });
    expect(mocks.read.kpis).toHaveBeenCalledWith({ tenantId: 7, siteId: OWN_SITE }, { days: 7, release: 'r2', filter: PHONES });
  });

  it('parses f.* into the issues read', async () => {
    mocks.read.issues.mockResolvedValue({ items: [], nextCursor: null, estimated: true });
    const res = await call(`/issues?site=${OWN_SITE}&status=new&limit=6&f.device.eq=phone`);
    expect(res.status).toBe(200);
    expect(mocks.read.issues).toHaveBeenCalledWith(
      { tenantId: 7, siteId: OWN_SITE },
      expect.objectContaining({ status: 'new', limit: 6, filter: PHONES }),
    );
  });
});

describe('GET /usage', () => {
  it('answers the caller workspace’s usage without a site', async () => {
    mocks.usageSnapshot.mockResolvedValue({ period: '2026-10', freeAllowance: 5000, freeUsed: 1, credits: 0, used: 1, limit: 5000 });
    const res = await call('/usage');
    expect(res.status).toBe(200);
    expect(mocks.usageSnapshot).toHaveBeenCalledWith({}, {}, 7);
  });
});

describe('DELETE /visitors/:visitorId', () => {
  it('erases the visitor inside the caller site only, and traces replay.visitor.erased', async () => {
    mocks.eraseReplayVisitor.mockResolvedValue(3);
    const res = await call(`/visitors/visitor_0001?site=${OWN_SITE}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ visitorId: 'visitor_0001', erased: 3 });
    expect(mocks.eraseReplayVisitor).toHaveBeenCalledWith({}, {}, 'visitor_0001', { tenantId: 7, siteId: OWN_SITE });
    expect(mocks.recordReplayTrace).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({
      verb: 'replay.visitor.erased', tenantId: 7, siteId: OWN_SITE, metadata: { visitorId: 'visitor_0001', erased: 3 },
    }));
  });

  it('needs MANAGER, the caller own site, and a well-formed id', async () => {
    expect((await call(`/visitors/visitor_0001?site=${OWN_SITE}`, { method: 'DELETE', headers: { 'x-role': 'developer' } })).status).toBe(403);
    expect((await call(`/visitors/visitor_0001?site=${OTHER_SITE}`, { method: 'DELETE' })).status).toBe(403);
    expect((await call(`/visitors/bad!?site=${OWN_SITE}`, { method: 'DELETE' })).status).toBe(400);
    expect(mocks.eraseReplayVisitor).not.toHaveBeenCalled();
  });
});
