/**
 * Stopping an A/B test from ANY path — including the general marketing route — bumps
 * the sites version of every Insights site its arms name, so the sites Worker's split
 * switches off on the next request (PRD 33 §5.1.4).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  bump: vi.fn(async () => {}),
  recordActivity: vi.fn(async () => {}),
  rows: [] as Array<{ siteId: string | null }>,
}));

vi.mock('./replayCacheKeys', () => ({ bumpReplaySitesVersion: mocks.bump }));
vi.mock('../activity/activityLog', () => ({ recordActivity: mocks.recordActivity }));

import { bumpSplitSitesForTest } from './abSplitVersion';
import { stopTest } from '../marketing/experimentation';

function fakeDb() {
  const chain = { from: () => chain, where: async () => mocks.rows };
  return {
    selectDistinct: () => chain,
    update: () => ({ set: () => ({ where: () => ({ returning: async () => [{ id: 5, key: 'rx-abc', status: 'stopped' }] }) }) }),
  };
}

beforeEach(() => {
  mocks.bump.mockClear();
  mocks.rows = [{ siteId: 'site-a' }, { siteId: null }];
});

describe('bumpSplitSitesForTest', () => {
  it('bumps every site the arms name, skipping arms without one', async () => {
    expect(await bumpSplitSitesForTest({} as never, fakeDb() as never, 7, 5)).toBe(1);
    expect(mocks.bump).toHaveBeenCalledWith({}, 7, 'site-a');
  });

  it('never throws and does nothing without an env', async () => {
    expect(await bumpSplitSitesForTest(undefined, fakeDb() as never, 7, 5)).toBe(0);
    const broken = { selectDistinct: () => { throw new Error('db down'); } };
    expect(await bumpSplitSitesForTest({} as never, broken as never, 7, 5)).toBe(0);
  });
});

describe('stopTest through the general route', () => {
  it('switches the split off at once', async () => {
    await stopTest(fakeDb() as never, {} as never, 7, { type: 'human', ref: 'u1', name: 'u1' } as never, 5, false);
    expect(mocks.bump).toHaveBeenCalledWith({}, 7, 'site-a');
  });
});
