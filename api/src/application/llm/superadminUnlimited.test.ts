import { describe, it, expect } from 'vitest';
import { resolveSuperadminUnlimited } from './tenantTokenAvailability';
import { enforceIngestionCap } from '../ingestion/ingestionLedger';
import { enforceOutboundFetchCap } from '../web/outboundFetchLedger';
import { enforceErrorEventsCap } from '../quality/errorEventsLedger';
import type { Db } from '../../infrastructure/database/connection';

/**
 * Chainable drizzle mock that also models `innerJoin` — the tenant-membership
 * lookup uses it, and a mock without it makes the superadmin check throw and fail
 * closed, which is exactly how this path stayed untested while the meter and the
 * gates drifted apart.
 */
function mockDb(queue: unknown[][]): Db {
  let i = 0;
  const take = () => (i < queue.length ? queue[i++] : []);
  const chain: Record<string, unknown> = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(take()),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(take()).then(resolve, reject),
  };
  return { select: () => chain } as unknown as Db;
}

const FREE_TENANT = [{ plan: 'free', billingStatus: 'none', trialEndsAt: null, tokenDailyLimitOverride: null }];
const SUPERADMIN_MEMBER = [{ isSuperadmin: true }];
const NO_SUPERADMIN_MEMBER: unknown[] = [];

describe('resolveSuperadminUnlimited', () => {
  it('trusts a caller-resolved flag without any query', async () => {
    const db = mockDb([]);
    expect(await resolveSuperadminUnlimited(db, 1, { actingIsSuperadmin: true })).toBe(true);
  });

  it('resolves the ACTING USER — a superadmin operating a tenant they are not a member of', async () => {
    // The reported case: the operator IS the superadmin, but the meter only ever
    // asked "does this tenant have a superadmin member?".
    const db = mockDb([[{ isSuperadmin: true }]]);
    expect(await resolveSuperadminUnlimited(db, 1, { actingUserId: 'u1' })).toBe(true);
  });

  it('falls back to the tenant\'s own active superadmin membership (cron paths, no acting user)', async () => {
    expect(await resolveSuperadminUnlimited(mockDb([SUPERADMIN_MEMBER]), 1)).toBe(true);
  });

  it('is false for an ordinary user in an ordinary tenant', async () => {
    const db = mockDb([[{ isSuperadmin: false }], NO_SUPERADMIN_MEMBER]);
    expect(await resolveSuperadminUnlimited(db, 1, { actingUserId: 'u1' })).toBe(false);
  });

  it('does not grant a bypass when the caller explicitly says not-superadmin', async () => {
    // actingIsSuperadmin === false must skip the user lookup but still allow the
    // tenant-membership path (an owned account stays unlimited on cron sweeps).
    expect(await resolveSuperadminUnlimited(mockDb([NO_SUPERADMIN_MEMBER]), 1, { actingIsSuperadmin: false })).toBe(false);
  });
});

describe('superadmin bypass reaches EVERY metered gate', () => {
  // Each gate reads the tenant row, then (being plan-capped) asks the superadmin
  // question. A `true` answer must return allowed WITHOUT a usage scan — so the
  // queue deliberately holds no usage row.
  it('ingestion', async () => {
    const db = mockDb([FREE_TENANT, SUPERADMIN_MEMBER]);
    expect(await enforceIngestionCap(db, 1)).toEqual({ allowed: true });
  });

  it('outbound fetches', async () => {
    const db = mockDb([FREE_TENANT, SUPERADMIN_MEMBER]);
    expect(await enforceOutboundFetchCap(db, 1)).toEqual({ allowed: true });
  });

  it('error events', async () => {
    const db = mockDb([FREE_TENANT, SUPERADMIN_MEMBER]);
    expect(await enforceErrorEventsCap(db, 1)).toEqual({ allowed: true });
  });

  it('still blocks an over-cap tenant with NO superadmin', async () => {
    const db = mockDb([FREE_TENANT, NO_SUPERADMIN_MEMBER, [{ used: 60_000_000 }]]);
    const r = await enforceIngestionCap(db, 1);
    expect(r.allowed).toBe(false);
  });
});
