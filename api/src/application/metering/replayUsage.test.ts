import { describe, it, expect } from 'vitest';
import {
  checkReplayAllowance,
  dailyTenantReplayRecordings,
  enforceReplayCap,
  recordReplayVisit,
  sumTenantReplayRecordings,
  sumTenantReplayStorageBytes,
} from './replayUsage';
import type { Db } from '../../infrastructure/database/connection';

/**
 * Same chainable drizzle mock as feedbackLedger.test.ts / ingestionLedger.test.ts.
 * Terminal `.limit()` (tenant row) and awaiting `.where()` (usage count) each
 * shift the next canned result. `innerJoin` is omitted so the superadmin-member
 * probe throws and falls through — same as the sibling cap tests.
 */
function mockDb(queue: unknown[][]): Db {
  let i = 0;
  const take = () => (i < queue.length ? queue[i++] : []);
  const chain: Record<string, unknown> = {
    from: () => chain,
    where: () => chain,
    groupBy: () => chain,
    orderBy: () => Promise.resolve(take()),
    limit: () => Promise.resolve(take()),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(take()).then(resolve, reject),
  };
  return {
    select: () => chain,
    insert: () => ({ values: () => Promise.resolve(undefined) }),
  } as unknown as Db;
}

const FREE_ROW = {
  plan: 'free',
  billingStatus: 'none',
  trialEndsAt: null,
  tokenDailyLimitOverride: null,
};

/** Matches the private default in replayUsage.ts (visit-count monthly cap). */
const REPLAY_MONTHLY_LIMIT = 50;

describe('sumTenantReplayRecordings', () => {
  it('floors and clamps the count', async () => {
    expect(await sumTenantReplayRecordings(mockDb([[{ used: 42 }]]), 1, new Date())).toBe(42);
    expect(await sumTenantReplayRecordings(mockDb([[{ used: null }]]), 1, new Date())).toBe(0);
  });

  it('fails OPEN (returns 0) when the accounting query throws', async () => {
    const broken = { select: () => { throw new Error('neon: connection reset'); } } as unknown as Db;
    expect(await sumTenantReplayRecordings(broken, 1, new Date())).toBe(0);
  });
});

describe('dailyTenantReplayRecordings', () => {
  it('maps UTC day buckets and clamps nulls', async () => {
    const db = mockDb([[
      { day: '2026-10-01', used: 3 },
      { day: '2026-10-02', used: null },
    ]]);
    await expect(dailyTenantReplayRecordings(db, 1, new Date())).resolves.toEqual([
      { day: '2026-10-01', value: 3 },
      { day: '2026-10-02', value: 0 },
    ]);
  });
});

describe('sumTenantReplayStorageBytes', () => {
  it('is zero until the visits table tracks bytes', async () => {
    expect(await sumTenantReplayStorageBytes(mockDb([]), 1, new Date())).toBe(0);
  });
});

describe('recordReplayVisit', () => {
  it('does not throw when the insert succeeds', async () => {
    await expect(recordReplayVisit(mockDb([]), {
      tenantId: 1,
      siteId: 'site-1',
      visitId: 'v1',
      recordedAt: new Date('2026-10-11T12:00:00.000Z'),
    })).resolves.toBeUndefined();
  });

  it('does not throw when the insert fails', async () => {
    const broken = {
      insert: () => { throw new Error('neon: connection reset'); },
    } as unknown as Db;
    await expect(recordReplayVisit(broken, {
      tenantId: 1,
      siteId: 'site-1',
      visitId: 'v1',
      recordedAt: new Date(),
    })).resolves.toBeUndefined();
  });
});

describe('enforceReplayCap', () => {
  it('free tenant under the monthly cap → allowed (no limit on the allowed path)', async () => {
    const db = mockDb([
      [FREE_ROW],
      [{ used: 10 }],
    ]);
    expect(await enforceReplayCap(db, 1)).toEqual({ allowed: true });
  });

  it('free tenant at the cap → refused with plan + used + limit', async () => {
    const db = mockDb([
      [FREE_ROW],
      [{ used: REPLAY_MONTHLY_LIMIT }],
    ]);
    const r = await enforceReplayCap(db, 1);
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.effectivePlan).toBe('free');
      expect(r.limit).toBe(REPLAY_MONTHLY_LIMIT);
      expect(r.used).toBe(REPLAY_MONTHLY_LIMIT);
    }
  });

  it('superadmin-unlimited tenant (override -1) → allowed regardless of usage', async () => {
    const db = mockDb([
      [{ ...FREE_ROW, tokenDailyLimitOverride: -1 }],
    ]);
    expect(await enforceReplayCap(db, 1)).toEqual({ allowed: true });
  });

  it('fails OPEN when the accounting query throws', async () => {
    const broken = { select: () => { throw new Error('neon: connection reset'); } } as unknown as Db;
    expect(await enforceReplayCap(broken, 1)).toEqual({ allowed: true });
  });
});

describe('checkReplayAllowance', () => {
  it('allowed path has no numeric limit (MonthlyTenantCapResult shape)', async () => {
    const db = mockDb([
      [{ used: 10 }],
      [FREE_ROW],
      [{ used: 10 }],
    ]);
    const r = await checkReplayAllowance(db, 1);
    expect(r).toEqual({
      allowed: true,
      currentUsage: 10,
      limit: null,
      remaining: null,
    });
    if (r.allowed) {
      const _limit: null = r.limit;
      const _remaining: null = r.remaining;
      expect(_limit).toBeNull();
      expect(_remaining).toBeNull();
    }
  });

  it('denied path carries used + limit from MonthlyTenantCapResult', async () => {
    const db = mockDb([
      [{ used: REPLAY_MONTHLY_LIMIT }],
      [FREE_ROW],
      [{ used: REPLAY_MONTHLY_LIMIT }],
    ]);
    const r = await checkReplayAllowance(db, 1);
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.currentUsage).toBe(REPLAY_MONTHLY_LIMIT);
      expect(r.limit).toBe(REPLAY_MONTHLY_LIMIT);
      expect(r.remaining).toBe(0);
    }
  });
});
