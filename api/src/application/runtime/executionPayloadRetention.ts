/**
 * Column-level retention for `executions` — blank the dispatch payload on old runs,
 * never the run.
 *
 * ── WHY NOT A SWEPT_TABLES ENTRY ─────────────────────────────────────────────────
 * `executions` fails that registry's membership test on every count, and the test is
 * the permission: it is domain data, not a diagnostic log; twelve relations foreign-key
 * it (`execution_messages`, `task_file_changes`, `agent_run_principals`,
 * `execution_lifecycle_outbox`, … ) with ON DELETE CASCADE, so deleting a row reaches far
 * past the table; and it has live writers that must not be blocked by the exclusive lock
 * a maintenance rewrite takes. So the sweep may neither purge nor rewrite it, exactly as
 * it may not touch `activity_log`.
 *
 * ── WHAT IS ACTUALLY BIG ─────────────────────────────────────────────────────────
 * Not the row count — 31,362 runs, of which only 136 are older than 60 days, so an
 * age-based purge would have freed nothing anyway. It is ONE column: `payload` averages
 * 977 bytes, 29 MB of a 52 MB heap, because it carries the whole serialised dispatch
 * request (prompt, role, repo context) for every run ever started.
 *
 * ── WHY `payload` AND NOTHING ELSE ───────────────────────────────────────────────
 * Every reader of `payload` operates on a run that is still in flight: the dispatcher and
 * self-heal path read it to resume or repair a live run, and the approval gate reads it
 * while a submission is pending. None of them can reach a run 30 days old.
 *
 * `result` and `error_message` are NOT blanked, only capped at ~1 KB on a terminal run past
 * 30 days (they were 8 + 7 MB of a database at its 512 MB ceiling). A person opening a month-old
 * run still sees how it ended; the full body is what no reader of a run that old reaches.
 *
 * The run itself is never deleted, so DORA, the ticket lifecycle ledger and usage
 * attribution — all of which read status, timestamps, `produced` and `task_id` — are
 * unaffected.
 */
import { and, isNotNull, lt, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { executions } from '../../infrastructure/database/schema';
import { acrossTenants } from '../../infrastructure/database/tenantScope';
import { PURGE_BATCH_ROWS } from '../maintenance/boundedPurge';

/** Days a run keeps its dispatch payload. Shorter than any window a live run can span. */
export const EXECUTION_PAYLOAD_RETENTION_DAYS = 30;

/**
 * Blank `executions.payload` on runs older than `cutoff`. Idempotent: the `IS NOT NULL`
 * predicate means a second pass matches nothing rather than rewriting every old row — and
 * its page — on every nightly tick.
 */
export async function redactStaleExecutionPayloads(db: Db, cutoff: Date): Promise<unknown> {
  await db.update(executions)
    .set({ payload: null })
    .where(acrossTenants(
      executions,
      'scheduled_sweep',
      and(lt(executions.createdAt, cutoff), isNotNull(executions.payload)),
    ));
  return db.execute(truncateTerminalOutputStatement(cutoff));
}

/** Kept head of `result` / `error_message` on a terminal run past the window. */
export const EXECUTION_OUTPUT_KEEP_CHARS = 1024;
/** Appended so a reader (and the idempotency predicate) can tell a truncated value. */
export const EXECUTION_OUTPUT_TRUNCATION_MARKER = ' …[truncated by retention]';

/**
 * Cap `result` and `error_message` at ~1 KB on terminal runs (completed / failed /
 * cancelled — never a live or paused one) older than `cutoff`. Bounded per run like the
 * registry purges. Idempotent: a truncated value is exactly KEEP + marker long, and the
 * predicate only matches values longer than that.
 */
export const truncateTerminalOutputStatement = (cutoff: Date) => {
  const keep = EXECUTION_OUTPUT_KEEP_CHARS;
  const marker = EXECUTION_OUTPUT_TRUNCATION_MARKER;
  const limit = keep + marker.length;
  return sql`
    UPDATE executions
    SET result = CASE WHEN char_length(result) > ${limit} THEN left(result, ${keep}) || ${marker} ELSE result END,
        error_message = CASE WHEN char_length(error_message) > ${limit} THEN left(error_message, ${keep}) || ${marker} ELSE error_message END
    WHERE ctid = ANY(ARRAY(
      SELECT ctid FROM executions
      WHERE status IN ('completed', 'failed', 'cancelled')
        AND created_at < ${cutoff.toISOString()}::timestamp
        AND (char_length(result) > ${limit} OR char_length(error_message) > ${limit})
      LIMIT ${PURGE_BATCH_ROWS}
    ))`;
};
