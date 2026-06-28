import { describe, it, expect } from 'vitest';
import { enforceErrorEventsCap, sumTenantErrorEvents } from './errorEventsLedger';
import type { Db } from '../../infrastructure/database/connection';

/** Same chainable drizzle mock shape as ingestionLedger.test.ts. */
function mockDb(queue: unknown[][]): Db {
  let i = 0;
  const take = () => (i < queue.length ? queue[i++] : []);
  const chain: Record<string, unknown> = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(take()),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(take()).then(resolve, reject),
  };
  return { select: () => chain } as unknown as Db;
}

describe('sumTenantErrorEvents', () => {
  it('floors and clamps the count', async () => {
    expect(await sumTenantErrorEvents(mockDb([[{ used: 42 }]]), 1, new Date())).toBe(42);
    expect(await sumTenantErrorEvents(mockDb([[{ used: null }]]), 1, new Date())).toBe(0);
  });
});

describe('enforceErrorEventsCap', () => {
  it('free tenant under the 10K monthly cap → allowed', async () => {
    const db = mockDb([
      [{ plan: 'free', billingStatus: 'none', trialEndsAt: null, tokenDailyLimitOverride: null }],
      [{ used: 100 }],
    ]);
    expect(await enforceErrorEventsCap(db, 1)).toEqual({ allowed: true });
  });

  it('free tenant over the 10K cap → blocked with plan + numbers', async () => {
    const db = mockDb([
      [{ plan: 'free', billingStatus: 'none', trialEndsAt: null, tokenDailyLimitOverride: null }],
      [{ used: 10_001 }],
    ]);
    const r = await enforceErrorEventsCap(db, 1);
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.effectivePlan).toBe('free');
      expect(r.limit).toBe(10_000);
      expect(r.used).toBe(10_001);
    }
  });

  it('teams tenant → unlimited, allowed without a usage scan', async () => {
    const db = mockDb([[{ plan: 'teams', billingStatus: 'active', trialEndsAt: null, tokenDailyLimitOverride: null }]]);
    expect(await enforceErrorEventsCap(db, 1)).toEqual({ allowed: true });
  });
});
