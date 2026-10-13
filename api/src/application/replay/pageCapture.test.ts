/**
 * Capturing key pages (PRD 33 §5.2): one `page_capture` job per page × device through
 * THE runner dispatch (no new queue), once per release, honest `unavailable` without a
 * runner, "capture now" once an hour, and the runner callback as the ONE row writer.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  provisioned: true,
  dispatch: vi.fn(async () => true),
  manifest: { pageKit: { url: 'https://cdn.builderforce.ai/replay/r/pagekit.abc123def456.js' } } as unknown,
  pages: ['/', '/pricing'] as string[],
  kv: new Map<string, unknown>(),
  upsertCapture: vi.fn(),
  setCaptureScore: vi.fn(async () => {}),
  listCaptures: vi.fn(async () => [] as unknown[]),
  bump: vi.fn(async () => {}),
}));

vi.mock('../qa/dispatchQaRunner', () => ({
  dispatchQaRunnerJob: mocks.dispatch,
  qaRunnerProvisioned: () => mocks.provisioned,
}));
vi.mock('./ReplayConfigService', () => ({ loadRecorderManifest: vi.fn(async () => mocks.manifest) }));
vi.mock('./pageSelection', () => ({ pagesToReview: vi.fn(async () => mocks.pages) }));
vi.mock('./ReplayReadService', () => ({
  ReplayReadService: vi.fn(function ReplayReadService() { return { releases: async () => [{ releaseKey: 'rel-new' }, { releaseKey: 'rel-old' }] }; }),
}));
vi.mock('../ide/siteTraffic', () => ({ siteForProject: vi.fn(async () => ({ siteId: 1, subdomain: 'shop', customDomain: null })) }));
vi.mock('./replaySiteAdmin', () => ({ getSiteDto: vi.fn(async () => ({ allowedOrigins: ['https://*.example.com', 'https://www.example.com/'] })) }));
vi.mock('./replaySites', () => ({
  getSite: vi.fn(async () => SITE),
  getSiteForTenant: vi.fn(async () => SITE),
}));
vi.mock('../../infrastructure/cache/readThroughCache', () => ({
  peekCached: vi.fn(async (_env: unknown, key: string) => mocks.kv.get(key) ?? null),
  setCached: vi.fn(async (_env: unknown, key: string, value: unknown) => { mocks.kv.set(key, value); }),
}));
vi.mock('./replayCacheKeys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./replayCacheKeys')>()),
  bumpSiteVersion: mocks.bump,
}));
vi.mock('./pageRunnerTokens', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./pageRunnerTokens')>()),
  mintCaptureToken: vi.fn(async (_env: unknown, input: { path: string; device: string }) => `tok:${input.path}:${input.device}`),
}));
vi.mock('./pageCaptureStore', () => ({
  upsertCapture: mocks.upsertCapture,
  setCaptureScore: mocks.setCaptureScore,
  listCaptures: mocks.listCaptures,
}));
vi.mock('./pageFactsReads', () => ({
  readPageBehaviour: vi.fn(async () => ({
    pages: new Map([['/pricing', { all: { sessions: 100, conversions: 4, frustrated: 10 }, desktop: { sessions: 60, conversions: 3, frustrated: 5 }, phone: { sessions: 40, conversions: 1, frustrated: 5 } }]]),
    site: { sessions: 1_000, conversions: 40 },
  })),
  readPageVitals: vi.fn(async () => new Map()),
}));
vi.mock('./replayDatabase', () => ({ replayTelemetryDb: (_env: unknown, db: unknown) => db }));

const SITE = { id: '11111111-2222-4333-8444-555555555555', tenantId: 7, kind: 'hosted', projectId: 42, label: 'Shop', status: 'active' };

import { captureNow, PageCaptureLimitError, queueReleaseCaptures, recordCapture, requestCaptures, siteOrigin } from './pageCapture';

const env = { INTERNAL_API_BASE_URL: 'https://api.test' } as never;

beforeEach(() => {
  mocks.provisioned = true;
  mocks.manifest = { pageKit: { url: 'https://cdn.builderforce.ai/replay/r/pagekit.abc123def456.js' } };
  mocks.pages = ['/', '/pricing'];
  mocks.kv.clear();
  mocks.dispatch.mockReset().mockResolvedValue(true);
  mocks.upsertCapture.mockReset();
  mocks.setCaptureScore.mockClear();
  mocks.listCaptures.mockReset().mockResolvedValue([]);
  mocks.bump.mockClear();
});

describe('requestCaptures', () => {
  it('queues one page_capture job per page × device through THE runner', async () => {
    const out = await requestCaptures(env, {} as never, SITE as never, 'rel-new');
    expect(out).toEqual({ status: 'queued', releaseKey: 'rel-new', queued: 4, pages: ['/', '/pricing'], reason: null });
    expect(mocks.dispatch).toHaveBeenCalledTimes(4);
    const jobs = mocks.dispatch.mock.calls.map((c) => (c as unknown as [unknown, { kind: string; jobId: string; payload: Record<string, unknown> }])[1]);
    expect(new Set(jobs.map((j) => j.kind))).toEqual(new Set(['page_capture']));
    expect(new Set(jobs.map((j) => j.jobId)).size).toBe(4);
    const phone = jobs.find((j) => j.payload.path === '/pricing' && j.payload.device === 'phone')!;
    expect(phone.payload).toMatchObject({
      url: 'https://shop.builderforce.ai/pricing',
      viewport: { w: 390, h: 844 },
      captureUrl: 'https://api.test/api/replay/page-runner/capture',
      captureToken: 'tok:/pricing:phone',
      pageKitGlobal: 'BuilderforcePageKit',
    });
    expect(jobs.find((j) => j.payload.device === 'desktop')!.payload.viewport).toEqual({ w: 1440, h: 900 });
  });

  it('uses the newest release when none is named', async () => {
    expect((await requestCaptures(env, {} as never, SITE as never, null)).releaseKey).toBe('rel-new');
  });

  it('caps at the selection (≤ 25 pages → ≤ 50 jobs)', async () => {
    mocks.pages = Array.from({ length: 25 }, (_, i) => `/p${i}`);
    const out = await requestCaptures(env, {} as never, SITE as never, 'r');
    expect(out.queued).toBe(50);
  });

  it('is honestly unavailable without a runner, a page kit or pages — and dispatches nothing', async () => {
    mocks.provisioned = false;
    expect(await requestCaptures(env, {} as never, SITE as never, 'r')).toMatchObject({ status: 'unavailable', reason: 'runner_unavailable', queued: 0 });
    mocks.provisioned = true;
    mocks.manifest = { latest: {} };
    expect(await requestCaptures(env, {} as never, SITE as never, 'r')).toMatchObject({ status: 'unavailable', reason: 'page_kit_unavailable' });
    mocks.manifest = { pageKit: { url: 'https://cdn.builderforce.ai/k.js' } };
    mocks.pages = [];
    expect(await requestCaptures(env, {} as never, SITE as never, 'r')).toMatchObject({ status: 'unavailable', reason: 'no_pages' });
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it('reports unavailable when the runner refused every job', async () => {
    mocks.dispatch.mockResolvedValue(false);
    expect(await requestCaptures(env, {} as never, SITE as never, 'r')).toMatchObject({ status: 'unavailable', reason: 'runner_unavailable', pages: ['/', '/pricing'] });
  });
});

describe('queueReleaseCaptures', () => {
  it('queues each release once', async () => {
    await queueReleaseCaptures(env, {} as never, SITE as never, 'rel-new');
    await queueReleaseCaptures(env, {} as never, SITE as never, 'rel-new');
    expect(mocks.dispatch).toHaveBeenCalledTimes(4);
    await queueReleaseCaptures(env, {} as never, SITE as never, 'rel-next');
    expect(mocks.dispatch).toHaveBeenCalledTimes(8);
  });
});

describe('captureNow', () => {
  it('runs once an hour per site; a request that queued nothing does not spend the hour', async () => {
    mocks.provisioned = false;
    await captureNow(env, {} as never, { tenantId: 7, siteId: SITE.id }, {});
    mocks.provisioned = true;
    expect((await captureNow(env, {} as never, { tenantId: 7, siteId: SITE.id }, { path: '/pricing' })).queued).toBe(2);
    await expect(captureNow(env, {} as never, { tenantId: 7, siteId: SITE.id }, {})).rejects.toBeInstanceOf(PageCaptureLimitError);
  });
});

describe('siteOrigin', () => {
  it('opens an external site on its first exact https origin', async () => {
    expect(await siteOrigin(env, {} as never, { ...SITE, kind: 'external', projectId: null } as never)).toBe('https://www.example.com');
  });
});

describe('recordCapture', () => {
  const claims = { typ: 'replay-page-capture' as const, xt: 7, sid: SITE.id, p: '/pricing', rk: 'rel-new', dc: 'phone' as const, exp: 9e9 };
  const facts = { seo: null, content: null, labPerf: null, a11y: { contrastFailures: [], smallTapTargets: [], missingLabels: [], missingAlt: [], focusOrderIssues: 0 } };

  it('writes the one row its token names, scores it, and says when both devices are in', async () => {
    mocks.upsertCapture.mockResolvedValue({ id: 'cap-1', score: null });
    mocks.listCaptures.mockResolvedValue([{ releaseKey: 'rel-new', deviceClass: 'phone' }, { releaseKey: 'rel-new', deviceClass: 'desktop' }]);
    const out = await recordCapture(env, {} as never, claims, facts);
    expect(mocks.upsertCapture).toHaveBeenCalledWith({}, expect.objectContaining({ tenantId: 7, siteId: SITE.id, path: '/pricing', releaseKey: 'rel-new', device: 'phone', facts }));
    const [, , id, score] = mocks.setCaptureScore.mock.calls[0] as unknown as [unknown, string, string, { frustration: number; accessibility: number }];
    expect(id).toBe('cap-1');
    expect(score).toMatchObject({ frustration: 88, accessibility: 100 });
    expect(out.reviewReady).toBe(true);
    expect(mocks.bump).toHaveBeenCalledWith(env, SITE.id);
  });

  it('is not ready for review with one device', async () => {
    mocks.upsertCapture.mockResolvedValue({ id: 'cap-1', score: null });
    mocks.listCaptures.mockResolvedValue([{ releaseKey: 'rel-new', deviceClass: 'phone' }, { releaseKey: 'rel-old', deviceClass: 'desktop' }]);
    expect((await recordCapture(env, {} as never, claims, facts)).reviewReady).toBe(false);
  });

  it('refuses a token for a site outside its workspace', async () => {
    await expect(recordCapture(env, {} as never, { ...claims, xt: 8 }, facts)).rejects.toThrow(/outside its workspace/);
    expect(mocks.upsertCapture).not.toHaveBeenCalled();
  });
});
