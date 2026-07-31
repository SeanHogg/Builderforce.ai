import { describe, it, expect } from 'vitest';
import { enforceCloudRunCap } from './cloudRunLedger';
import type { Db } from '../../infrastructure/database/connection';

/**
 * Minimal fake drizzle builder: each terminal chain resolves to the next queued
 * result set. enforceCloudRunCap issues its selects in order — (1) the tenant row,
 * (2) the superadmin-member lookup (only when the tenant is capped), then (3) the
 * cloud-run usage scan (only when NOT superadmin) — so we queue results in that order.
 */
function fakeDb(results: unknown[][]): Db {
  let i = 0;
  const makeChain = (): Record<string, unknown> => {
    const chain: Record<string, unknown> = {};
    for (const m of ['from', 'where', 'limit', 'innerJoin', 'groupBy', 'orderBy']) {
      chain[m] = () => chain;
    }
    chain.then = (resolve: (v: unknown) => unknown) => resolve(results[i++] ?? []);
    return chain;
  };
  return { select: () => makeChain() } as unknown as Db;
}

const freeTenant = { plan: 'free', billingStatus: 'none', trialEndsAt: null, tokenDailyLimitOverride: null };

describe('enforceCloudRunCap', () => {
  it('blocks a free tenant over its monthly cloud-run allowance', async () => {
    const db = fakeDb([
      [freeTenant],
      [],                                   // no superadmin member
      [{ day: '2026-07-01', used: 999 }],   // usage far over any free cap
    ]);
    const r = await enforceCloudRunCap(db, 1);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.used).toBeGreaterThanOrEqual(r.limit);
  });

  it('a superadmin-owned tenant is unlimited (bypasses the cap, no usage scan)', async () => {
    // Only two result sets queued: tenant row + superadmin-member hit. If the code
    // reached the usage scan it would read `[]` → 0 runs and still pass, so to prove
    // the BYPASS specifically we assert allowed even though usage would be over cap:
    const db = fakeDb([
      [freeTenant],
      [{ isSuperadmin: true }],             // an active superadmin member ⇒ unlimited
      [{ day: '2026-07-01', used: 999 }],   // would exhaust the cap if it were consulted
    ]);
    const r = await enforceCloudRunCap(db, 1);
    expect(r.allowed).toBe(true);
  });

  it('fails OPEN (allowed) when the lookup throws', async () => {
    const throwingDb = { select: () => { throw new Error('db down'); } } as unknown as Db;
    expect((await enforceCloudRunCap(throwingDb, 1)).allowed).toBe(true);
  });
});
