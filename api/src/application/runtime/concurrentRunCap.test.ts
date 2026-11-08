import { describe, expect, it } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';
import { PLAN_LIMITS, resolveConcurrentCloudRuns } from '../../domain/tenant/PlanLimits';
import { TenantPlan } from '../../domain/shared/types';
import { enforceConcurrentRunCap } from './concurrentRunCap';

/** Each terminal chain resolves to the next queued result set (see cloudRunLedger.test). */
function fakeDb(results: unknown[][]): Db {
  let i = 0;
  const makeChain = (): Record<string, unknown> => {
    const chain: Record<string, unknown> = {};
    for (const m of ['from', 'where', 'limit', 'innerJoin', 'groupBy', 'orderBy']) chain[m] = () => chain;
    chain.then = (resolve: (v: unknown) => unknown) => resolve(results[i++] ?? []);
    return chain;
  };
  return { select: () => makeChain() } as unknown as Db;
}

const freeTenant = { plan: 'free', billingStatus: 'none', trialEndsAt: null, tokenDailyLimitOverride: null };
const freeCap = PLAN_LIMITS[TenantPlan.FREE].maxConcurrentCloudRuns;

describe('plan limits for concurrent cloud runs (PRD 09 D8)', () => {
  it('every plan declares a cap, rising with the plan', () => {
    const { free, pro, teams } = {
      free: PLAN_LIMITS[TenantPlan.FREE].maxConcurrentCloudRuns,
      pro: PLAN_LIMITS[TenantPlan.PRO].maxConcurrentCloudRuns,
      teams: PLAN_LIMITS[TenantPlan.TEAMS].maxConcurrentCloudRuns,
    };
    expect(free).toBeGreaterThan(0);
    expect(pro).toBeGreaterThan(free);
    expect(teams).toBeGreaterThan(pro);
  });

  it('a -1 token override lifts the cap (a superadmin is lifted by the shared tenant-cap policy, below)', () => {
    expect(resolveConcurrentCloudRuns({ effectivePlan: TenantPlan.FREE, tokenDailyLimitOverride: -1 })).toBe(-1);
    expect(resolveConcurrentCloudRuns({ effectivePlan: TenantPlan.FREE, tokenDailyLimitOverride: null })).toBe(freeCap);
  });
});

describe('enforceConcurrentRunCap', () => {
  it('blocks a tenant already at its cap, reporting the cap and the live count', async () => {
    const r = await enforceConcurrentRunCap(fakeDb([[freeTenant], [], [{ n: freeCap }]]), 1);
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.limit).toBe(freeCap);
      expect(r.used).toBe(freeCap);
    }
  });

  it('admits a tenant one below its cap', async () => {
    const r = await enforceConcurrentRunCap(fakeDb([[freeTenant], [], [{ n: freeCap - 1 }]]), 1);
    expect(r.allowed).toBe(true);
  });

  it('a superadmin-owned tenant bypasses the cap even when over it', async () => {
    const r = await enforceConcurrentRunCap(fakeDb([[freeTenant], [{ isSuperadmin: true }], [{ n: 999 }]]), 1);
    expect(r.allowed).toBe(true);
  });

  it('the acting user is threaded to the superadmin bypass, as the budget floor does', async () => {
    const r = await enforceConcurrentRunCap(fakeDb([[freeTenant], [{ isSuperadmin: true }], [{ n: 999 }]]), 1, undefined, { actingUserId: 'u-super' });
    expect(r.allowed).toBe(true);
  });

  it('an unlimited plan skips the live-run count entirely', async () => {
    const unlimited = { ...freeTenant, tokenDailyLimitOverride: -1 };
    expect((await enforceConcurrentRunCap(fakeDb([[unlimited], [], [{ n: 999 }]]), 1)).allowed).toBe(true);
  });

  it('fails open when the lookup throws', async () => {
    const broken = { select: () => { throw new Error('db down'); } } as unknown as Db;
    expect((await enforceConcurrentRunCap(broken, 1)).allowed).toBe(true);
  });
});
