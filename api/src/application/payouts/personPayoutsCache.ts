/**
 * The cache key for a PERSON's payouts across every workspace, and its invalidation.
 *
 * A person's payout ledger rows are recorded per workspace, but a person-level read
 * (the sales hub's balance and history) spans all of them, so it is cached under a
 * version token keyed by the person — never by a tenant. `PayoutAccountService.pay`
 * bumps it on every recorded payout to a `user` account; the TTL is only a backstop.
 *
 * Kept apart from the service so the writer and the reader import one key format
 * without a cycle.
 */

import type { Env } from '../../env';
import { bumpCacheVersion } from '../../infrastructure/cache/readThroughCache';
import { reportCaughtError } from '../observability/caughtErrorReporter';

export const personPayoutsVersionKey = (userId: string): string => `payouts:person:${userId}`;

/** Best-effort: a cache bump must never fail the payout it follows. */
export async function invalidatePersonPayouts(env: Env | undefined, userId: string): Promise<void> {
  if (!env) return;
  await bumpCacheVersion(env, personPayoutsVersionKey(userId)).catch((error) => {
    reportCaughtError(error, { source: 'application/payouts/personPayoutsCache.ts', operation: 'invalidatePersonPayouts' });
  });
}
