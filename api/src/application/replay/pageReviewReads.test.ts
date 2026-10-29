/**
 * `pageReview` caches the review under the site's version, but whether a fix's coding run
 * is still going is live: the cached review carries `buildPreview` as the cache-safe list
 * left it, and the hold is applied AFTER the cache on a copy — so a run that ends is seen
 * on the next read without waiting for the cache to expire.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReplayPrescriptionDto } from '@builderforce/interaction-contract';

const mocks = vi.hoisted(() => ({
  cache: new Map<string, unknown>(),
  runningTaskIds: [] as number[],
  listCaptures: vi.fn(async () => []),
  listPrescriptionsCached: vi.fn(),
  releases: vi.fn(async () => []),
}));

vi.mock('../../infrastructure/cache/readThroughCache', () => ({
  getOrSetCached: async (_env: unknown, key: string, load: () => Promise<unknown>) => {
    if (!mocks.cache.has(key)) mocks.cache.set(key, await load());
    return mocks.cache.get(key);
  },
}));
vi.mock('./replayCacheKeys', () => ({ replayReadKeys: async () => ({ pageReview: (path: string) => `page-review:${path}` }) }));
vi.mock('./pageCaptureStore', () => ({
  afterAssetKey: vi.fn(), AFTER_ASSETS: [], captureAssetUrl: vi.fn(), findCapture: vi.fn(), isAfterAsset: vi.fn(),
  isCaptureAsset: vi.fn(), listCaptures: mocks.listCaptures, scoreOf: vi.fn(), streamObject: vi.fn(), toCaptureDto: vi.fn(),
}));
vi.mock('./pageAggregates', () => ({ newestCaptures: vi.fn() }));
vi.mock('./pageSelection', () => ({ pagesToReview: vi.fn() }));
vi.mock('./prescriptionReads', () => ({ loadPrescriptionRow: vi.fn(), listPrescriptionsCached: mocks.listPrescriptionsCached }));
vi.mock('./ReplayReadService', () => ({ ReplayReadService: vi.fn(function ReplayReadService() { return { releases: mocks.releases }; }) }));

import { pageReview } from './pageReviewReads';

const OFFER = { projectId: 42, rebuild: false };
const rx = (id: string, taskId: number) => ({
  id, pagePath: '/checkout', status: 'applied', buildPreview: OFFER, refs: { taskId },
}) as unknown as ReplayPrescriptionDto;

const db = { selectDistinct: () => ({ from: () => ({ where: async () => mocks.runningTaskIds.map((taskId) => ({ taskId })) }) }) } as never;
const SCOPE = { tenantId: 7, siteId: '11111111-2222-4333-8444-555555555555' };

beforeEach(() => {
  mocks.cache.clear();
  mocks.runningTaskIds = [];
  mocks.listPrescriptionsCached.mockReset().mockResolvedValue([rx('rx-1', 77), rx('rx-2', 78)]);
});

describe('pageReview', () => {
  it('withdraws the build offer from a fix whose run is going, after the cache', async () => {
    mocks.runningTaskIds = [77];
    const review = await pageReview({} as never, db, SCOPE, '/checkout');
    expect(review.prescriptions.map((p) => p.buildPreview)).toEqual([null, OFFER]);
  });

  it('sees a run end on the next read without the cached review changing', async () => {
    mocks.runningTaskIds = [77, 78];
    expect((await pageReview({} as never, db, SCOPE, '/checkout')).prescriptions.map((p) => p.buildPreview)).toEqual([null, null]);

    mocks.runningTaskIds = [78];
    const again = await pageReview({} as never, db, SCOPE, '/checkout');
    expect(again.prescriptions.map((p) => p.buildPreview)).toEqual([OFFER, null]);
    expect(mocks.listPrescriptionsCached).toHaveBeenCalledTimes(1); // the second answer came from the cache
  });

  it('does not put the held (copied) rows into the cache', async () => {
    mocks.runningTaskIds = [77];
    await pageReview({} as never, db, SCOPE, '/checkout');
    const cached = mocks.cache.get('page-review:/checkout') as { prescriptions: ReplayPrescriptionDto[] };
    expect(cached.prescriptions.map((p) => p.buildPreview)).toEqual([OFFER, OFFER]);
  });
});
