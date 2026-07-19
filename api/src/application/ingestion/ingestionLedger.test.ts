import { describe, it, expect } from 'vitest';
import { enforceIngestionCap, sumTenantIngestionBytes, tenantIngestionBytesByProvider } from './ingestionLedger';
import type { Db } from '../../infrastructure/database/connection';

/**
 * Drizzle-style chainable mock. Each terminal (`.limit(1)` for the tenant lookup,
 * or awaiting `.where(...)` for the byte sum) shifts the next canned result off
 * the queue. enforceIngestionCap awaits the tenant row THEN the sum, so the queue
 * order is [tenantRow, sumRow].
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

describe('sumTenantIngestionBytes', () => {
  it('floors and clamps the summed bytes', async () => {
    const db = mockDb([[{ used: 1234.9 }]]);
    expect(await sumTenantIngestionBytes(db, 1, new Date())).toBe(1234);
  });

  it('null sum → 0', async () => {
    const db = mockDb([[{ used: null }]]);
    expect(await sumTenantIngestionBytes(db, 1, new Date())).toBe(0);
  });
});

describe('tenantIngestionBytesByProvider', () => {
  it('normalizes grouped provider totals for integration cards', async () => {
    const db = mockDb([[
      { provider: 'github', used: 1234.9 },
      { provider: 'jira', used: null },
    ]]);
    await expect(tenantIngestionBytesByProvider(db, 1, new Date())).resolves.toEqual([
      { key: 'github', used: 1234 },
      { key: 'jira', used: 0 },
    ]);
  });
});

describe('enforceIngestionCap', () => {
  it('free tenant under the monthly cap → allowed', async () => {
    const db = mockDb([
      [{ plan: 'free', billingStatus: 'none', trialEndsAt: null, tokenDailyLimitOverride: null }],
      [{ used: 1_000 }],
    ]);
    expect(await enforceIngestionCap(db, 1)).toEqual({ allowed: true });
  });

  it('free tenant over the 50MB cap → blocked with plan + numbers', async () => {
    const db = mockDb([
      [{ plan: 'free', billingStatus: 'none', trialEndsAt: null, tokenDailyLimitOverride: null }],
      [{ used: 60_000_000 }],
    ]);
    const r = await enforceIngestionCap(db, 1);
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.effectivePlan).toBe('free');
      expect(r.limit).toBe(50_000_000);
      expect(r.used).toBe(60_000_000);
    }
  });

  it('teams tenant → unlimited, allowed without a usage scan', async () => {
    const db = mockDb([
      [{ plan: 'teams', billingStatus: 'active', trialEndsAt: null, tokenDailyLimitOverride: null }],
    ]);
    expect(await enforceIngestionCap(db, 1)).toEqual({ allowed: true });
  });

  it('superadmin-unlimited tenant (override -1) → allowed regardless of usage', async () => {
    const db = mockDb([
      [{ plan: 'free', billingStatus: 'none', trialEndsAt: null, tokenDailyLimitOverride: -1 }],
    ]);
    expect(await enforceIngestionCap(db, 1)).toEqual({ allowed: true });
  });
});
