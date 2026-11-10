/**
 * The stale-export purge: personal data is not kept indefinitely. An access / portability export
 * nobody marked delivered is deleted from file storage once it is older than the retention window
 * (run by the governance-auditor sweep).
 *
 * NO STARVATION. The sweep walks candidates OLDEST FIRST, `(updated_at, id)` ascending, by keyset
 * cursor, and stops after {@link PURGE_ATTEMPTS_PER_SWEEP} delete attempts. A row whose delete
 * fails is not retried every sweep: the failure count and the next attempt time are recorded in
 * the row's `execution_result.exportPurge` (an existing column - no migration), with an
 * exponential backoff capped at a week, and rows in backoff are passed over by the cursor without
 * spending an attempt. So a row R2 keeps refusing can never hold the head of the queue and starve
 * the rows behind it, and each failure is REPORTED (with its count) so a stuck export is seen.
 *
 * `updated_at` is deliberately NOT touched by a failure: it is what the retention window is
 * measured from, and bumping it would hide the row from the purge for another 30 days.
 */
import { and, asc, eq, like, lt, ne, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { dataSubjectRequests } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { deletePrivateObject } from '../assets/tenantAssetStore';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { parseDsrExecutionResult, type DsrExecutionResult } from './dsrExecution';

/** An export nobody marked delivered is deleted after this long: personal data is not kept indefinitely. */
export const UNDELIVERED_EXPORT_RETENTION_DAYS = 30;
/** Delete attempts one sweep makes (successes and failures both count; rows in backoff do not). */
export const PURGE_ATTEMPTS_PER_SWEEP = 100;
/** Candidate rows read per page; the sweep reads at most {@link PURGE_MAX_PAGES} pages. */
export const PURGE_PAGE_SIZE = 100;
export const PURGE_MAX_PAGES = 10;
/** Backoff after the Nth consecutive failure: 1h, 2h, 4h ... capped at a week. */
export const PURGE_MAX_BACKOFF_MS = 7 * 24 * 3_600_000;

const HOUR_MS = 3_600_000;
const SOURCE = 'application/governance/dsrExportPurge.ts';

export function purgeBackoffMs(failures: number): number {
  return Math.min(HOUR_MS * 2 ** Math.max(0, failures - 1), PURGE_MAX_BACKOFF_MS);
}

/** `updated_at` at the millisecond precision a JS `Date` cursor carries, so the keyset is exact. */
const updatedAtMs = sql`date_trunc('milliseconds', ${dataSubjectRequests.updatedAt})`;

interface Candidate { id: string; tenantId: number; executionResult: string | null; updatedAt: Date }

/** Delete stale undelivered exports. Returns how many were deleted. */
export async function purgeStaleDsrExports(db: Db, bucket: R2Bucket | undefined, now: Date = new Date()): Promise<number> {
  if (!bucket) return 0;
  const cutoff = new Date(now.getTime() - UNDELIVERED_EXPORT_RETENTION_DAYS * 24 * HOUR_MS);
  let cursor: { updatedAt: Date; id: string } | null = null;
  let attempts = 0;
  let purged = 0;

  for (let page = 0; page < PURGE_MAX_PAGES && attempts < PURGE_ATTEMPTS_PER_SWEEP; page += 1) {
    const rows: Candidate[] = await db.select({
      id: dataSubjectRequests.id, tenantId: dataSubjectRequests.tenantId,
      executionResult: dataSubjectRequests.executionResult, updatedAt: dataSubjectRequests.updatedAt,
    }).from(dataSubjectRequests).where(and(
      ne(dataSubjectRequests.status, 'completed'),
      lt(dataSubjectRequests.updatedAt, cutoff),
      like(dataSubjectRequests.executionResult, '%"exportKey":"%'),
      cursor
        ? sql`(${updatedAtMs}, ${dataSubjectRequests.id}) > (${cursor.updatedAt.toISOString()}::timestamp, ${cursor.id}::uuid)`
        : undefined,
    )).orderBy(asc(updatedAtMs), asc(dataSubjectRequests.id)).limit(PURGE_PAGE_SIZE);

    for (const row of rows) {
      cursor = { updatedAt: row.updatedAt, id: row.id };
      const result = parseDsrExecutionResult(row.executionResult);
      if (!result?.exportKey) continue;
      const retryAt = result.exportPurge?.nextAttemptAt;
      if (retryAt && Date.parse(retryAt) > now.getTime()) continue; // in backoff: no attempt spent
      if (attempts >= PURGE_ATTEMPTS_PER_SWEEP) break;
      attempts += 1;
      if (await purgeOne(db, bucket, row, result, now)) purged += 1;
    }
    if (rows.length < PURGE_PAGE_SIZE) break;
  }
  return purged;
}

/** One delete attempt; records the outcome on the row. True when the export is gone. */
async function purgeOne(db: Db, bucket: R2Bucket, row: Candidate, result: DsrExecutionResult, now: Date): Promise<boolean> {
  const exportKey = result.exportKey as string;
  let failure: unknown = null;
  try {
    if (!(await deletePrivateObject(bucket, exportKey, row.tenantId))) {
      failure = new Error('The export key is not a private object of this tenant; the purge refused to delete it.');
    }
  } catch (error) {
    failure = error;
  }

  const next: DsrExecutionResult = failure
    ? { ...result, exportPurge: failedAttempt(result, now) }
    : { ...result, exportKey: null, exportPurge: null, note: 'The undelivered export expired and was deleted.' };
  await db.update(dataSubjectRequests)
    .set({ executionResult: JSON.stringify(next) })
    .where(scopedToTenant(dataSubjectRequests, row.tenantId, eq(dataSubjectRequests.id, row.id)));

  if (failure) {
    reportCaughtError(failure, {
      source: SOURCE,
      operation: 'purgeStaleDsrExports delete',
      level: next.exportPurge!.failures >= 3 ? 'error' : 'warning',
      context: { tenantId: row.tenantId, dsrId: row.id, failures: next.exportPurge!.failures, nextAttemptAt: next.exportPurge!.nextAttemptAt },
    });
    return false;
  }
  return true;
}

function failedAttempt(result: DsrExecutionResult, now: Date): { failures: number; nextAttemptAt: string } {
  const failures = (result.exportPurge?.failures ?? 0) + 1;
  return { failures, nextAttemptAt: new Date(now.getTime() + purgeBackoffMs(failures)).toISOString() };
}
