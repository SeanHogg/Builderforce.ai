import { describe, it, expect } from 'vitest';
import { enforceOutboundFetchCap, sumTenantOutboundFetches } from './outboundFetchLedger';
import type { Db } from '../../infrastructure/database/connection';

/** Same chainable drizzle mock shape as errorEventsLedger.test.ts. */
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

describe('sumTenantOutboundFetches', () => {
  it('floors and clamps the count', async () => {
    expect(await sumTenantOutboundFetches(mockDb([[{ used: 42 }]]), 1, new Date())).toBe(42);
    expect(await sumTenantOutboundFetches(mockDb([[{ used: null }]]), 1, new Date())).toBe(0);
  });
});

describe('enforceOutboundFetchCap', () => {
  it('free tenant under the 500/mo cap → allowed', async () => {
    const db = mockDb([
      [{ plan: 'free', billingStatus: 'none', trialEndsAt: null, tokenDailyLimitOverride: null }],
      [{ used: 10 }],
    ]);
    expect(await enforceOutboundFetchCap(db, 1)).toEqual({ allowed: true });
  });

  it('free tenant over the 500/mo cap → blocked with plan + numbers', async () => {
    const db = mockDb([
      [{ plan: 'free', billingStatus: 'none', trialEndsAt: null, tokenDailyLimitOverride: null }],
      [{ used: 501 }],
    ]);
    const r = await enforceOutboundFetchCap(db, 1);
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.effectivePlan).toBe('free');
      expect(r.limit).toBe(500);
      expect(r.used).toBe(501);
    }
  });

  it('teams tenant → unlimited, allowed without a usage scan', async () => {
    const db = mockDb([[{ plan: 'teams', billingStatus: 'active', trialEndsAt: null, tokenDailyLimitOverride: null }]]);
    expect(await enforceOutboundFetchCap(db, 1)).toEqual({ allowed: true });
  });

  it('fails open on a query error → allowed', async () => {
    const throwing = { select: () => { throw new Error('db down'); } } as unknown as Db;
    expect(await enforceOutboundFetchCap(throwing, 1)).toEqual({ allowed: true });
  });
});
