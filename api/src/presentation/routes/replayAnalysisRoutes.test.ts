/**
 * `/api/replay/*` analysis routes: the Insights gate, the `?site=` rule (D17),
 * MANAGER on writes, the AI budget's 429 `{ error: 'limit' }`, and the read API —
 * a `replay:read` tenant key opens EXACTLY `GET /overview`, `GET /recordings` and
 * `GET /funnels/:id/evaluate`, and nothing else. Auth is a header-driven stand-in
 * that refuses a key-shaped bearer exactly as the real JWT check would; services are
 * mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../../env';
import { ForbiddenError, UnauthorizedError } from '../../domain/shared/errors';

const OWN_SITE = '11111111-2222-4333-8444-555555555555';
const OTHER_SITE = '99999999-2222-4333-8444-555555555555';
const FUNNEL = 'ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const REC = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const READ_KEY = 'bfk_read0000000000000000000000000000';
const INGEST_KEY = 'bfr_0123456789abcdef0123456789abcdef';

const mocks = vi.hoisted(() => ({
  entitled: true,
  getSiteForTenant: vi.fn(),
  requirePublicApiKey: vi.fn(),
  listSegments: vi.fn(async () => []),
  createSegment: vi.fn(async () => ({ id: 's1' })),
  overview: vi.fn(async () => ({ sessions: 1, estimated: false })),
  evaluate: vi.fn(async () => ({ funnelId: 'f', steps: [], truncated: false, estimated: true })),
  summarizeRecording: vi.fn(),
  summarizeSegment: vi.fn(),
  listRecordings: vi.fn(async () => ({ items: [], nextCursor: null })),
}));

vi.mock('../middleware/authMiddleware', async (importOriginal) => {
  const real = await importOriginal<typeof import('../middleware/authMiddleware')>();
  const fakeAuth: MiddlewareHandler<HonoEnv> = async (c, next) => {
    // A key is not a session: the real middleware fails its JWT check the same way.
    if ((c.req.header('Authorization') ?? '').startsWith('Bearer bf')) throw new UnauthorizedError('Invalid or expired token');
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
// A key-authenticated request has no session handle; the stand-in answers one without a real connection.
vi.mock('../../application/shared/dbHandle', () => ({
  requestDb: (c: { get(key: 'db'): unknown }) => c.get('db') ?? {},
}));
vi.mock('../../application/publicApi/publicApiAuth', () => ({ requirePublicApiKey: mocks.requirePublicApiKey }));
vi.mock('../../application/replay/replaySegments', () => ({
  listSegments: mocks.listSegments, createSegment: mocks.createSegment, updateSegment: vi.fn(), deleteSegment: vi.fn(),
}));
vi.mock('../../application/replay/replayFilterOptions', () => ({ filterOptions: vi.fn(async () => []) }));
vi.mock('../../application/replay/ReplayOverviewService', () => ({
  ReplayOverviewService: vi.fn(function ReplayOverviewService() { return { overview: mocks.overview }; }),
}));
vi.mock('../../application/replay/replaySmartEvents', () => ({
  listSmartEvents: vi.fn(async () => []), createSmartEvent: vi.fn(), deleteSmartEvent: vi.fn(), previewSmartEvent: vi.fn(),
}));
vi.mock('../../application/replay/ReplayFunnelService', () => ({
  ReplayFunnelService: vi.fn(function ReplayFunnelService() {
    return { evaluate: mocks.evaluate, list: vi.fn(async () => []), get: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() };
  }),
}));
vi.mock('../../application/replay/replayFlow', () => ({ replayFlow: vi.fn(async () => ({ nodes: [], edges: [], totals: {} })) }));
vi.mock('../../application/replay/replaySummaries', () => ({
  summarizeRecording: mocks.summarizeRecording, summarizeSegment: mocks.summarizeSegment,
}));
vi.mock('../../application/replay/ReplayReadService', () => ({
  ReplayReadService: vi.fn(function ReplayReadService() { return { listRecordings: mocks.listRecordings }; }),
}));
vi.mock('../../application/replay/replayTrace', () => ({ recordReplayTrace: vi.fn(async () => {}), REPLAY_TRACE_VERBS: {} }));
vi.mock('../../application/replay/replayUsage', () => ({ usageSnapshot: vi.fn() }));

import { errorHandler } from '../middleware/errorHandler';
import { ReplayAiLimitError } from '../../application/replay/replayAiBudget';
import { createReplayAnalysisRoutes } from './replayAnalysisRoutes';
import { createReplayRoutes } from './replayRoutes';

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as never;

function call(path: string, init: RequestInit & { tenant?: number; role?: string; key?: string } = {}) {
  const router = createReplayAnalysisRoutes();
  router.route('/', createReplayRoutes());
  router.onError(errorHandler as never);
  const headers = new Headers(init.headers);
  if (init.tenant) headers.set('x-tenant', String(init.tenant));
  if (init.role) headers.set('x-role', init.role);
  if (init.key) headers.set('Authorization', `Bearer ${init.key}`);
  if (init.body) headers.set('content-type', 'application/json');
  return router.request(path, { ...init, headers }, {} as never, ctx);
}

beforeEach(() => {
  mocks.entitled = true;
  for (const fn of [mocks.getSiteForTenant, mocks.requirePublicApiKey, mocks.summarizeRecording, mocks.summarizeSegment]) fn.mockReset();
  for (const fn of [mocks.listSegments, mocks.createSegment, mocks.overview, mocks.evaluate, mocks.listRecordings]) fn.mockClear();
  mocks.getSiteForTenant.mockImplementation(async (_env: unknown, _db: unknown, tenantId: number, siteId: string) => {
    if (tenantId !== 7 || siteId !== OWN_SITE) throw new ForbiddenError('That Insights site is not in this workspace');
    return { id: siteId, tenantId };
  });
  mocks.requirePublicApiKey.mockImplementation(async (_db: unknown, header: string | undefined, _origin: unknown, scope: string) =>
    (header === `Bearer ${READ_KEY}` && scope === 'replay:read'
      ? { ok: true, keyId: 'k1', tenantId: 7 }
      : { ok: false, error: 'Invalid or revoked API key', status: 401 }));
});

describe('members', () => {
  it('reads segments of their own site, and 403s on another workspace\'s site', async () => {
    expect((await call(`/segments?site=${OWN_SITE}`)).status).toBe(200);
    expect(mocks.listSegments).toHaveBeenCalledWith({}, {}, { tenantId: 7, siteId: OWN_SITE });
    expect((await call(`/segments?site=${OTHER_SITE}`)).status).toBe(403);
    expect((await call(`/overview?site=${OWN_SITE}`, { tenant: 8 })).status).toBe(403);
  });

  it('passes the URL filter to the overview', async () => {
    await call(`/overview?site=${OWN_SITE}&days=7&f.device.eq=phone`);
    expect(mocks.overview).toHaveBeenCalledWith({ tenantId: 7, siteId: OWN_SITE }, { days: 7, filter: { all: [{ field: 'device', op: 'eq', value: 'phone' }] } });
  });

  it('is behind the Insights gate', async () => {
    mocks.entitled = false;
    expect((await call(`/funnels?site=${OWN_SITE}`)).status).toBe(403);
    expect(mocks.getSiteForTenant).not.toHaveBeenCalled();
  });

  it('needs MANAGER to write', async () => {
    const body = JSON.stringify({ name: 'Phones', filter: { all: [] } });
    expect((await call(`/segments?site=${OWN_SITE}`, { method: 'POST', body, role: 'developer' })).status).toBe(403);
    expect(mocks.createSegment).not.toHaveBeenCalled();
    expect((await call(`/segments?site=${OWN_SITE}`, { method: 'POST', body })).status).toBe(201);
  });
});

describe('AI summaries', () => {
  it('answers 429 { error: "limit" } when the daily budget is spent', async () => {
    mocks.summarizeRecording.mockRejectedValueOnce(new ReplayAiLimitError());
    const res = await call(`/recordings/${REC}/summary?site=${OWN_SITE}`, { method: 'POST' });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'limit' });
  });

  it('passes regenerate and the actor through', async () => {
    mocks.summarizeRecording.mockResolvedValueOnce({ recordingId: REC, summary: 'x #0.', citations: [], model: null, generatedAt: 'now' });
    const res = await call(`/recordings/${REC}/summary?site=${OWN_SITE}`, { method: 'POST', body: JSON.stringify({ regenerate: true }) });
    expect(res.status).toBe(200);
    expect(mocks.summarizeRecording).toHaveBeenCalledWith({}, {}, { tenantId: 7, siteId: OWN_SITE }, REC, { regenerate: true, actorId: 'u1' });
  });

  it('refuses an invalid segment filter', async () => {
    const res = await call(`/summary?site=${OWN_SITE}`, { method: 'POST', body: JSON.stringify({ filter: { all: [{ field: 'nope' }] } }) });
    expect(res.status).toBe(400);
    expect(mocks.summarizeSegment).not.toHaveBeenCalled();
  });
});

describe('the read API: replay:read keys', () => {
  it('opens GET /overview, GET /recordings and GET /funnels/:id/evaluate for the key\'s workspace', async () => {
    expect((await call(`/overview?site=${OWN_SITE}`, { key: READ_KEY })).status).toBe(200);
    expect((await call(`/recordings?site=${OWN_SITE}`, { key: READ_KEY })).status).toBe(200);
    expect((await call(`/funnels/${FUNNEL}/evaluate?site=${OWN_SITE}`, { key: READ_KEY })).status).toBe(200);
    expect(mocks.requirePublicApiKey).toHaveBeenCalledWith(expect.anything(), `Bearer ${READ_KEY}`, null, 'replay:read');
    expect(mocks.overview).toHaveBeenCalledTimes(1);
    expect(mocks.listRecordings).toHaveBeenCalledTimes(1);
    expect(mocks.evaluate).toHaveBeenCalledTimes(1);
  });

  it('opens nothing else — every other route treats the key as a failed session', async () => {
    expect((await call(`/segments?site=${OWN_SITE}`, { key: READ_KEY })).status).toBe(401);
    expect((await call(`/flow?site=${OWN_SITE}`, { key: READ_KEY })).status).toBe(401);
    expect((await call(`/funnels?site=${OWN_SITE}`, { key: READ_KEY })).status).toBe(401);
    expect((await call(`/recordings/${REC}/summary?site=${OWN_SITE}`, { key: READ_KEY, method: 'POST' })).status).toBe(401);
    expect((await call(`/segments?site=${OWN_SITE}`, { key: READ_KEY, method: 'POST', body: '{"name":"x","filter":{"all":[]}}' })).status).toBe(401);
    expect(mocks.listSegments).not.toHaveBeenCalled();
    expect(mocks.createSegment).not.toHaveBeenCalled();
  });

  it('refuses a site key (replay:ingest only) and a key for another workspace\'s site', async () => {
    expect((await call(`/overview?site=${OWN_SITE}`, { key: INGEST_KEY })).status).toBe(401);
    mocks.requirePublicApiKey.mockResolvedValueOnce({ ok: true, keyId: 'k2', tenantId: 8 });
    expect((await call(`/overview?site=${OWN_SITE}`, { key: READ_KEY })).status).toBe(403);
    expect(mocks.overview).not.toHaveBeenCalled();
  });
});
