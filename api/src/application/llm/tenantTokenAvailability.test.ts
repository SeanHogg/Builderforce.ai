import { describe, it, expect } from 'vitest';
import { getTenantTokenAvailability } from './tenantTokenAvailability';
import type { Db } from '../../infrastructure/database/connection';

/**
 * Minimal fake drizzle query builder: each terminal chain resolves to the next
 * queued result. getTenantTokenAvailability issues at most two selects — the
 * tenant row, then (only if capped) the usage scan — so we queue results in order.
 */
function fakeDb(results: unknown[][]): Db {
  let i = 0;
  const makeChain = (): Record<string, unknown> => {
    const chain: Record<string, unknown> = {};
    for (const m of ['from', 'where', 'limit', 'innerJoin', 'groupBy', 'orderBy']) {
      chain[m] = () => chain;
    }
    // Thenable: awaiting the chain yields the next queued result set.
    chain.then = (resolve: (v: unknown) => unknown) => resolve(results[i++] ?? []);
    return chain;
  };
  return { select: () => makeChain() } as unknown as Db;
}

const activePro = {
  plan: 'pro', billingStatus: 'active', trialEndsAt: null, tokenDailyLimitOverride: null,
};

describe('getTenantTokenAvailability', () => {
  it('unlimited override short-circuits with no usage scan', async () => {
    const db = fakeDb([[{ ...activePro, tokenDailyLimitOverride: -1 }]]);
    const a = await getTenantTokenAvailability(db, 1);
    expect(a.hasTokens).toBe(true);
    expect(a.reason).toBeNull();
    expect(a.dailyLimit).toBe(-1);
    expect(a.monthlyLimit).toBe(-1);
  });

  it('reports daily_exhausted when today usage is at/over an explicit daily grant', async () => {
    // override 1000 → daily cap 1000, monthly unlimited. Usage day 1000 >= cap.
    const db = fakeDb([
      [{ ...activePro, tokenDailyLimitOverride: 1000 }],
      [{ day: 1000, month: 1000 }],
    ]);
    const a = await getTenantTokenAvailability(db, 1);
    expect(a.hasTokens).toBe(false);
    expect(a.reason).toBe('daily_exhausted');
  });

  it('has tokens when usage is under the cap', async () => {
    const db = fakeDb([
      [{ ...activePro, tokenDailyLimitOverride: 1000 }],
      [{ day: 10, month: 10 }],
    ]);
    const a = await getTenantTokenAvailability(db, 1);
    expect(a.hasTokens).toBe(true);
    expect(a.reason).toBeNull();
  });

  it('a free (billing none) tenant resolves to the free plan copy', async () => {
    const db = fakeDb([
      [{ plan: 'pro', billingStatus: 'none', trialEndsAt: null, tokenDailyLimitOverride: null }],
      [{ day: 0, month: 0 }],
    ]);
    const a = await getTenantTokenAvailability(db, 1);
    // billing 'none' downgrades pro→free regardless of the stored plan.
    expect(a.effectivePlan).toBe('free');
  });
});
