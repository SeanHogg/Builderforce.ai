/**
 * The conversion half of "Test it": a chunk carrying `data-variant` whose marks hit
 * the test's success records ONE conversion for its arm, once per visit; anything
 * that is not ours, or a failure, records nothing and never throws.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReplayChunk } from '@builderforce/interaction-contract';

const mocks = vi.hoisted(() => ({
  runningSplitForSite: vi.fn(),
  recordConversion: vi.fn(async () => {}),
}));
vi.mock('../ide/siteAbSplit', () => ({ runningSplitForSite: mocks.runningSplitForSite }));
vi.mock('../marketing/experimentation', () => ({ recordConversion: mocks.recordConversion }));
vi.mock('../observability/caughtErrorReporter', () => ({ reportCaughtError: vi.fn() }));

import { __clearL1CacheForTests } from '../../infrastructure/cache/readThroughCache';
import { recordVariantConversion } from './replayAbConversion';

const site = { id: 'site-1', tenantId: 7 } as never;
const SPLIT = {
  testId: 12,
  variants: [{ id: 101, key: 'live', trafficPercent: 50, r2Prefix: null, versionToken: null }, { id: 102, key: 'preview', trafficPercent: 50, r2Prefix: 'p/', versionToken: 'p' }],
  success: { smartEvent: null },
};
const chunk = (over: Partial<ReplayChunk>): ReplayChunk => ({
  v: 1, visitorId: 'bfr_v', visitId: 'visit-1', seq: 0, startedAt: 0, release: 'p', recorderVersion: '1',
  device: { class: 'desktop', w: 1440, h: 900 }, newVisitor: true, keep: null, sampleWeight: 1,
  // A built-in goal: the order-confirmation page (`purchase`), the same rule `converted` uses.
  marks: [{ kind: 'page', key: '/order-confirmation', atMs: 1000 }],
  ...over,
} as ReplayChunk);

beforeEach(() => {
  __clearL1CacheForTests();
  mocks.runningSplitForSite.mockReset();
  mocks.runningSplitForSite.mockResolvedValue(SPLIT);
  mocks.recordConversion.mockClear();
});

describe('recordVariantConversion', () => {
  it('counts a goal mark once per visit against the arm the visitor saw', async () => {
    expect(await recordVariantConversion({} as never, {} as never, site, chunk({ variant: 'ab12:preview' }))).toBe(true);
    expect(mocks.recordConversion).toHaveBeenCalledWith({}, 7, 102);
    expect(await recordVariantConversion({} as never, {} as never, site, chunk({ variant: 'ab12:preview', seq: 1 }))).toBe(false);
    expect(mocks.recordConversion).toHaveBeenCalledTimes(1);
  });

  it('records nothing without a goal, for another test, or for a label that is not ours', async () => {
    expect(await recordVariantConversion({} as never, {} as never, site, chunk({ variant: 'ab12:live', visitId: 'v2', marks: [{ kind: 'page', key: '/', atMs: 0 }] }))).toBe(false);
    expect(await recordVariantConversion({} as never, {} as never, site, chunk({ variant: 'ab99:preview', visitId: 'v3' }))).toBe(false);
    expect(await recordVariantConversion({} as never, {} as never, site, chunk({ variant: 'B', visitId: 'v4' }))).toBe(false);
    expect(mocks.recordConversion).not.toHaveBeenCalled();
  });

  it('never throws', async () => {
    mocks.runningSplitForSite.mockRejectedValueOnce(new Error('db down'));
    await expect(recordVariantConversion({} as never, {} as never, site, chunk({ variant: 'ab12:preview', visitId: 'v5' }))).resolves.toBe(false);
  });
});
