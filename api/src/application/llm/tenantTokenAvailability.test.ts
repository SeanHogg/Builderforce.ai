import { describe, it, expect } from 'vitest';
import { getTenantTokenAvailability, checkTenantTokenGate } from './tenantTokenAvailability';
import type { Db } from '../../infrastructure/database/connection';

/**
 * Minimal fake drizzle query builder: each terminal chain resolves to the next
 * queued result. For a CAPPED tenant getTenantTokenAvailability issues the tenant
 * row, an optional acting-user superadmin lookup, a tenant-superadmin-member lookup
 * (empty = none), then the usage scan — so we queue results in that order. An
 * already-unlimited tenant stops after the tenant row.
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
    // Selects: tenant row, tenant-superadmin lookup (none), usage scan.
    const db = fakeDb([
      [{ ...activePro, tokenDailyLimitOverride: 1000 }],
      [],
      [{ day: 1000, month: 1000 }],
    ]);
    const a = await getTenantTokenAvailability(db, 1);
    expect(a.hasTokens).toBe(false);
    expect(a.reason).toBe('daily_exhausted');
  });

  it('has tokens when usage is under the cap', async () => {
    const db = fakeDb([
      [{ ...activePro, tokenDailyLimitOverride: 1000 }],
      [],
      [{ day: 10, month: 10 }],
    ]);
    const a = await getTenantTokenAvailability(db, 1);
    expect(a.hasTokens).toBe(true);
    expect(a.reason).toBeNull();
  });

  it('a free (billing none) tenant resolves to the free plan copy', async () => {
    const db = fakeDb([
      [{ plan: 'pro', billingStatus: 'none', trialEndsAt: null, tokenDailyLimitOverride: null }],
      [],
      [{ day: 0, month: 0 }],
    ]);
    const a = await getTenantTokenAvailability(db, 1);
    // billing 'none' downgrades pro→free regardless of the stored plan.
    expect(a.effectivePlan).toBe('free');
  });

  it('a superadmin acting user is unlimited even on a capped free tenant (no usage scan)', async () => {
    // Order of selects with actingUserId: tenant row, then users.isSuperadmin. The
    // superadmin short-circuit skips both the tenant-member lookup and the usage scan.
    const db = fakeDb([
      [{ plan: 'free', billingStatus: 'none', trialEndsAt: null, tokenDailyLimitOverride: null }],
      [{ isSuperadmin: true }],
    ]);
    const a = await getTenantTokenAvailability(db, 1, { actingUserId: 'user_admin' });
    expect(a.hasTokens).toBe(true);
    expect(a.reason).toBeNull();
    expect(a.dailyLimit).toBe(-1);
    expect(a.monthlyLimit).toBe(-1);
  });

  it('a tenant OWNED by a superadmin is unlimited with NO acting user (the cron path)', async () => {
    // The fix: cron sweeps call with `db` only (no actingUserId). A capped free tenant
    // whose active membership includes a superadmin must still be unlimited, so the
    // manager sweep + autonomous executor never freeze a superadmin-owned account.
    // Selects: tenant row, then tenant-superadmin lookup (FOUND) → no usage scan.
    const db = fakeDb([
      [{ plan: 'free', billingStatus: 'none', trialEndsAt: null, tokenDailyLimitOverride: null }],
      [{ isSuperadmin: true }],
    ]);
    const a = await getTenantTokenAvailability(db, 1);
    expect(a.hasTokens).toBe(true);
    expect(a.reason).toBeNull();
    expect(a.dailyLimit).toBe(-1);
    expect(a.monthlyLimit).toBe(-1);
  });

  it('a caller-provided superadmin principal (the gateway) is unlimited with NO user query', async () => {
    // The gateway passes actingIsSuperadmin (already resolved from `access`), which also
    // covers bfk_* key-creators that have no user row. Only the tenant row is read —
    // no users.isSuperadmin query, no tenant-member lookup, no usage scan.
    const db = fakeDb([
      [{ plan: 'free', billingStatus: 'none', trialEndsAt: null, tokenDailyLimitOverride: null }],
    ]);
    const a = await getTenantTokenAvailability(db, 1, { actingIsSuperadmin: true });
    expect(a.hasTokens).toBe(true);
    expect(a.dailyLimit).toBe(-1);
    expect(a.monthlyLimit).toBe(-1);
  });

  it('a caller-provided non-superadmin principal skips the user query but still checks tenant ownership', async () => {
    // actingIsSuperadmin=false → NO users.isSuperadmin query; the tenant-member lookup
    // (empty here) is the only superadmin resolution, then the usage scan.
    const db = fakeDb([
      [{ ...activePro, tokenDailyLimitOverride: 1000 }],
      [],
      [{ day: 1000, month: 1000 }],
    ]);
    const a = await getTenantTokenAvailability(db, 1, { actingUserId: 'u', actingIsSuperadmin: false });
    expect(a.hasTokens).toBe(false);
    expect(a.reason).toBe('daily_exhausted');
  });

  it('a non-superadmin acting user is still gated by the tenant cap', async () => {
    // Selects: tenant row, acting-user superadmin (false), tenant-superadmin (none), usage.
    const db = fakeDb([
      [{ ...activePro, tokenDailyLimitOverride: 1000 }],
      [{ isSuperadmin: false }],
      [],
      [{ day: 1000, month: 1000 }],
    ]);
    const a = await getTenantTokenAvailability(db, 1, { actingUserId: 'user_dev' });
    expect(a.hasTokens).toBe(false);
    expect(a.reason).toBe('daily_exhausted');
  });
});

describe('checkTenantTokenGate', () => {
  it('returns null (proceed) when the tenant has budget', async () => {
    const db = fakeDb([
      [{ ...activePro, tokenDailyLimitOverride: 1000 }],
      [],
      [{ day: 10, month: 10 }],
    ]);
    expect(await checkTenantTokenGate(db, 1)).toBeNull();
  });

  it('returns a 429 block with the gateway daily code when the daily cap is hit', async () => {
    const db = fakeDb([
      [{ ...activePro, tokenDailyLimitOverride: 1000 }],
      [],
      [{ day: 1000, month: 1000 }],
    ]);
    const block = await checkTenantTokenGate(db, 1);
    expect(block?.code).toBe('plan_token_limit_exceeded');
    expect(block?.reason).toBe('daily_exhausted');
    expect(block?.error).toContain('daily token limit reached');
  });

  it('fails OPEN (returns null) when the availability lookup throws', async () => {
    const throwingDb = { select: () => { throw new Error('db down'); } } as unknown as Db;
    expect(await checkTenantTokenGate(throwingDb, 1)).toBeNull();
  });
});
