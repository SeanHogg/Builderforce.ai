/**
 * THE TAX REPORTING CACHE TOKEN — one key, three callers.
 *
 * A year-end report is expensive (a full-year ledger aggregate plus a batched
 * profile load) and read repeatedly during a close window, so it is cached. It
 * is invalidated by TWO unrelated writers — a payout lands new money in the
 * year, and a profile save changes a recipient's facts or their threshold — and
 * read by a third. Version token rather than key deletion because the keyspace
 * is unbounded: one key per year, and the year is caller-supplied.
 *
 * It lives in its own module for the dull reason that both writers need it and
 * `taxReport` already imports `taxProfile`. Putting the token in either one
 * makes the other import it back, and a cycle between a writer and a reader is
 * how a cache ends up invalidated by nobody. The writer owns the token; the
 * reader only ever reads it.
 */

import type { Env } from '../../env';
import { bumpCacheVersion } from '../../infrastructure/cache/readThroughCache';

/** The version key for every cached tax report and year listing in a workspace. */
export function taxReportVersionKey(tenantId: number): string {
  return `tax:report:v:${tenantId}`;
}

/**
 * Invalidate every cached tax report for a workspace.
 *
 * Called by the payout path and by a tax-profile save — never by a reader.
 * Failing to bump does not corrupt anything; it serves a stale year for up to
 * the KV TTL, which is why this is safe to call optimistically after a write.
 */
export async function bumpTaxReportVersion(env: Env, tenantId: number): Promise<void> {
  await bumpCacheVersion(env, taxReportVersionKey(tenantId));
}
