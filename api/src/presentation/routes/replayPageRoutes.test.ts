/**
 * `/api/replay` page-review routes (PRD 33 §5.2): members go through the Insights gate
 * and the D17 `?site=` scope; "capture now" is MANAGER; the runner callbacks take ONLY
 * the job's capability token. The application use cases and the site lookup are mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../../env';
import { ForbiddenError, UnauthorizedError } from '../../domain/shared/errors';

const OWN_SITE = '11111111-2222-4333-8444-555555555555';
const OTHER_SITE = '99999999-2222-4333-8444-555555555555';
const RX = '33333333-2222-4333-8444-555555555555';
const CAP = '44444444-2222-4333-8444-555555555555';

const mocks = vi.hoisted(() => ({
  entitled: true,
  getSiteForTenant: vi.fn(),
  getSite: vi.fn(async () => ({ id: '11111111-2222-4333-8444-555555555555', tenantId: 7 })),
  listPages: vi.fn(async () => [{ path: '/', score: 80, topPrescriptionId: null, foldThumbUrl: null, opportunity: 0 }]),
  pageReview: vi.fn(async () => ({ path: '/pricing', captures: [], prescriptions: [], scoreByRelease: [] })),
  captureNow: vi.fn(),
  captureAsset: vi.fn(),
  pagePrompt: vi.fn(async () => ({ audience: 'composer', prompt: 'P', selectors: [], prescriptionIds: [] })),
  prescriptionPrompt: vi.fn(async () => ({ audience: 'coding_agent', prompt: 'P', selectors: ['a'], prescriptionIds: ['x'] })),
  previewUrlFor: vi.fn(async () => ({ releaseKey: 'abc', url: 'https://shop.builderforce.ai/?bf_preview=t', expiresAt: '2026-10-13T12:30:00.000Z' })),
  listSequenceChoices: vi.fn(async () => [{ id: 's1', name: 'Win-back' }]),
  listCodingAgentChoices: vi.fn(async () => [{ ref: 'agent-1', name: 'Coder' }]),
  verifyCaptureToken: vi.fn(),
  verifyRenderToken: vi.fn(),
  recordCapture: vi.fn(),
  putObject: vi.fn(async () => {}),
  reviewPage: vi.fn(async () => ({ reviewed: true, accepted: 1, skipped: null })),
  storeRenderAsset: vi.fn(async () => {}),
  recordRender: vi.fn(async () => ({ updated: true })),
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
    entitled: mocks.entitled, reason: mocks.entitled ? 'capability' : 'not_entitled', feature, label: 'Insights',
    currentPlan: 'free', requiredPlan: 'teams', capability: 'session-replay',
  })),
  tenantHasFeature: vi.fn(),
  toTenantPlan: vi.fn(),
}));
vi.mock('../../application/replay/replaySites', () => ({ getSiteForTenant: mocks.getSiteForTenant, getSite: mocks.getSite }));
vi.mock('../../application/replay/pageReviewReads', () => ({ listPages: mocks.listPages, pageReview: mocks.pageReview, captureAsset: mocks.captureAsset }));
vi.mock('../../application/replay/pageCapture', () => ({ captureNow: mocks.captureNow, recordCapture: mocks.recordCapture }));
vi.mock('../../application/replay/pageCaptureStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../application/replay/pageCaptureStore')>()),
  putObject: mocks.putObject,
}));
vi.mock('../../application/replay/pagePrompts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../application/replay/pagePrompts')>()),
  pagePrompt: mocks.pagePrompt,
  prescriptionPrompt: mocks.prescriptionPrompt,
}));
vi.mock('../../application/replay/pageRender', () => ({ storeRenderAsset: mocks.storeRenderAsset, recordRender: mocks.recordRender }));
vi.mock('../../application/replay/pageRunnerTokens', () => ({ verifyCaptureToken: mocks.verifyCaptureToken, verifyRenderToken: mocks.verifyRenderToken }));
vi.mock('../../application/replay/releasePreview', () => ({ previewUrlFor: mocks.previewUrlFor }));
vi.mock('../../application/replay/prescriptionChoices', () => ({
  listSequenceChoices: mocks.listSequenceChoices,
  listCodingAgentChoices: mocks.listCodingAgentChoices,
}));
vi.mock('../../application/replay/visionReview', () => ({ reviewPage: mocks.reviewPage }));
vi.mock('../../application/shared/dbHandle', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../application/shared/dbHandle')>()),
  requestDb: () => ({}),
}));

import { errorHandler } from '../middleware/errorHandler';
import { createReplayPageRoutes } from './replayPageRoutes';

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as never;

function call(path: string, init: RequestInit & { tenant?: number; role?: string } = {}) {
  const router = createReplayPageRoutes();
  router.onError(errorHandler as never);
  const headers = new Headers(init.headers);
  if (init.tenant) headers.set('x-tenant', String(init.tenant));
  if (init.role) headers.set('x-role', init.role);
  return router.request(path, { ...init, headers }, {} as never, ctx);
}

const CLAIMS = { typ: 'replay-page-capture', xt: 7, sid: OWN_SITE, p: '/pricing', rk: 'r1', dc: 'phone', exp: 9e9 };

beforeEach(() => {
  mocks.entitled = true;
  for (const fn of [mocks.captureNow, mocks.captureAsset, mocks.verifyCaptureToken, mocks.verifyRenderToken, mocks.recordCapture,
    mocks.putObject, mocks.reviewPage, mocks.recordRender, mocks.listPages, mocks.prescriptionPrompt, mocks.pagePrompt]) fn.mockClear();
  mocks.getSiteForTenant.mockReset().mockImplementation(async (_env: unknown, _db: unknown, tenantId: number, siteId: string) => {
    if (tenantId !== 7 || siteId !== OWN_SITE) throw new ForbiddenError('That Insights site is not in this workspace');
    return { id: siteId, tenantId };
  });
  mocks.verifyCaptureToken.mockReset().mockImplementation(async (_env: unknown, auth: string | undefined) => {
    if (auth !== 'Bearer good') throw new UnauthorizedError('Invalid or expired runner token');
    return CLAIMS;
  });
});

describe('member routes', () => {
  it('lists the key pages in the caller’s scope', async () => {
    const res = await call(`/pages?site=${OWN_SITE}`);
    expect(res.status).toBe(200);
    expect(mocks.listPages).toHaveBeenCalledWith({}, {}, { tenantId: 7, siteId: OWN_SITE });
  });

  it('answers 403 for another workspace’s site and for a workspace without Insights', async () => {
    expect((await call(`/pages?site=${OTHER_SITE}`)).status).toBe(403);
    mocks.entitled = false;
    expect((await call(`/pages/review?site=${OWN_SITE}&path=/`)).status).toBe(403);
  });

  it('reads a page review by path', async () => {
    await call(`/pages/review?site=${OWN_SITE}&path=%2Fpricing`);
    expect(mocks.pageReview).toHaveBeenCalledWith({}, {}, { tenantId: 7, siteId: OWN_SITE }, '/pricing');
  });

  it('capture now is MANAGER and answers 202 when queued', async () => {
    mocks.captureNow.mockResolvedValue({ status: 'queued', releaseKey: 'r1', queued: 2, pages: ['/'], reason: null });
    const res = await call(`/pages/capture?site=${OWN_SITE}`, { method: 'POST', body: JSON.stringify({ path: '/' }), headers: { 'content-type': 'application/json' } });
    expect(res.status).toBe(202);
    expect(mocks.captureNow).toHaveBeenCalledWith({}, {}, { tenantId: 7, siteId: OWN_SITE }, { path: '/' });
    expect((await call(`/pages/capture?site=${OWN_SITE}`, { method: 'POST', role: 'developer' })).status).toBe(403);
  });

  it('capture now answers 200 for an honest unavailable', async () => {
    mocks.captureNow.mockResolvedValue({ status: 'unavailable', releaseKey: null, queued: 0, pages: [], reason: 'runner_unavailable' });
    const res = await call(`/pages/capture?site=${OWN_SITE}`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect((await res.json()).reason).toBe('runner_unavailable');
  });

  it('streams a capture asset privately', async () => {
    mocks.captureAsset.mockResolvedValue({ body: new Response('img').body, contentType: 'image/jpeg', size: 3 });
    const res = await call(`/pages/captures/${CAP}/after-phone?site=${OWN_SITE}&prescription=${RX}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('private');
    expect(mocks.captureAsset).toHaveBeenCalledWith({}, {}, { tenantId: 7, siteId: OWN_SITE }, CAP, 'after-phone', RX);
  });

  it('compiles prompts with the requested audience and rejects an unknown one', async () => {
    await call(`/prescriptions/${RX}/prompt?site=${OWN_SITE}&audience=site_builder`);
    expect(mocks.prescriptionPrompt).toHaveBeenCalledWith({}, {}, { tenantId: 7, siteId: OWN_SITE }, RX, 'site_builder');
    await call(`/pages/prompt?site=${OWN_SITE}&path=%2Fpricing`);
    expect(mocks.pagePrompt).toHaveBeenCalledWith({}, {}, { tenantId: 7, siteId: OWN_SITE }, '/pricing', 'coding_agent');
    expect((await call(`/pages/prompt?site=${OWN_SITE}&path=%2F&audience=robot`)).status).toBe(400);
  });

  it('returns a preview URL for a release, and the pickers', async () => {
    const preview = await call(`/releases/abc/preview?site=${OWN_SITE}`);
    expect(await preview.json()).toMatchObject({ url: expect.stringContaining('bf_preview=') });
    expect(mocks.previewUrlFor).toHaveBeenCalledWith({}, {}, { tenantId: 7, siteId: OWN_SITE }, 'abc');
    expect(await (await call(`/sequences?site=${OWN_SITE}`)).json()).toEqual([{ id: 's1', name: 'Win-back' }]);
    expect(await (await call(`/coding-agents?site=${OWN_SITE}`)).json()).toEqual([{ ref: 'agent-1', name: 'Coder' }]);
  });
});

describe('runner callbacks', () => {
  const json = (body: unknown, auth = 'Bearer good'): RequestInit => ({
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', Authorization: auth },
  });

  it('refuses a capture without the job token', async () => {
    expect((await call('/page-runner/capture', json({}, 'Bearer bad'))).status).toBe(401);
    expect(mocks.recordCapture).not.toHaveBeenCalled();
  });

  it('stores an asset under the token’s own capture key', async () => {
    const res = await call('/page-runner/capture/assets/fold', { method: 'POST', body: 'jpeg', headers: { 'content-type': 'image/jpeg', Authorization: 'Bearer good' } });
    expect(res.status).toBe(200);
    const [, key, input] = mocks.putObject.mock.calls[0]!;
    expect(key).toMatch(new RegExp(`^replay/pages/t7/${OWN_SITE}/r1/[0-9a-f]+-phone-fold\\.jpg$`));
    expect(input).toMatchObject({ expected: 'image/jpeg' });
    expect((await call('/page-runner/capture/assets/video', { method: 'POST', body: 'x', headers: { Authorization: 'Bearer good' } })).status).toBe(404);
  });

  it('records the capture and runs the vision review once both devices are in', async () => {
    mocks.recordCapture.mockResolvedValue({ capture: { id: CAP }, reviewReady: true });
    const res = await call('/page-runner/capture', json({ seo: { title: 'x' }, content: null }));
    expect(res.status).toBe(200);
    expect(mocks.recordCapture).toHaveBeenCalledWith({}, {}, CLAIMS, { seo: { title: 'x' }, content: null, labPerf: null, a11y: null });
    expect(mocks.reviewPage).toHaveBeenCalledWith({}, {}, expect.objectContaining({ id: OWN_SITE }), '/pricing');
  });

  it('does not review a page with one device captured', async () => {
    mocks.recordCapture.mockResolvedValue({ capture: { id: CAP }, reviewReady: false });
    await call('/page-runner/capture', json({}));
    expect(mocks.reviewPage).not.toHaveBeenCalled();
  });

  it('records a render with the render token', async () => {
    mocks.verifyRenderToken.mockResolvedValue({ typ: 'replay-page-render', xt: 7, sid: OWN_SITE, pid: RX, exp: 9e9 });
    const res = await call(`/page-runner/render/${RX}`, json({ devices: ['desktop', 'phone'] }));
    expect(res.status).toBe(200);
    expect(mocks.verifyRenderToken).toHaveBeenCalledWith({}, 'Bearer good', RX);
    expect(mocks.recordRender).toHaveBeenCalledWith({}, {}, expect.objectContaining({ pid: RX }), ['desktop', 'phone']);
  });
});
