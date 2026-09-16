/**
 * dayFold — the driver both grain rollups share.
 *
 * `rollUpToolAudit` and `rollUpLlmUsage` differ entirely in their fold STATEMENT and not
 * at all in how that statement is scheduled: enumerate the whole calendar days strictly
 * before a cutoff, oldest first, bounded so one tick cannot run away, fold each, and
 * accumulate what it did. That shape was written twice, and the second copy is what
 * exposed the defect in the first — neither isolated a day that the statement refused.
 *
 * WHY ISOLATION IS THE POINT, not a nicety. Days are visited OLDEST FIRST, so an
 * unhandled failure on one day aborts the pass before every later day — and does so
 * permanently, because the next tick starts from the same oldest day and fails the same
 * way. The relation then looks exactly as it would if it had no rollup at all, with the
 * only evidence a single caught error in the sweep above. Isolating per day means a day
 * the statement cannot fold is left RAW — nothing lost, simply not compressed — and is
 * NAMED in the result so the difference between "nothing to do" and "could not" is
 * visible.
 *
 * WHOLE DAYS ONLY. `cutoff` is floored to its calendar day by the caller's own query, so
 * the day a cutoff falls in is never folded — a partially folded day is the one shape
 * that could double-count, and it is excluded by construction rather than by care.
 */
import { sql } from 'drizzle-orm';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import type { Db } from '../../infrastructure/database/connection';

/** Days folded per invocation, unless a caller says otherwise. Bounds the work of one
 *  sweep tick; a backlog drains over consecutive ticks rather than in one long
 *  transaction against a relation with live writers. */
export const DEFAULT_MAX_FOLD_DAYS = 14;

export interface DayFoldResult {
  /** Calendar days folded this run. */
  days: number;
  /** Raw rows removed. */
  folded: number;
  /** Tally rows written or added to. */
  tallies: number;
  /** Days the statement refused, left raw — `{ day, error }` each. */
  skipped: Array<{ day: string; error: string }>;
}

export interface DayFoldSpec {
  /** Physical relation being folded — used only to name the relation in a log line. */
  relation: string;
  /** Its timestamp column, as a raw identifier (`ts`, `created_at`). Interpolated into
   *  the day-enumeration statement, so it must be a literal from the call site and never
   *  anything a request can influence. */
  tsColumn: string;
  /** Fold one whole calendar day (`YYYY-MM-DD`). Must be ONE statement, so the delete and
   *  the insert share a snapshot. */
  foldDay: (db: Db, day: string) => Promise<unknown>;
  /** Source module, for the error report on a refused day. */
  source: string;
  /** Operation name, for the error report on a refused day. */
  operation: string;
}

/** Rows of `{ tallies, folded }` come back untyped from `db.execute`. Shared because both
 *  fold statements end in the same two-column SELECT. */
export function readFoldCounts(result: unknown): { tallies: number; folded: number } {
  const row = (Array.isArray(result) ? result[0] : (result as { rows?: unknown[] })?.rows?.[0]) as
    | { tallies?: unknown; folded?: unknown }
    | undefined;
  return { tallies: Number(row?.tallies ?? 0), folded: Number(row?.folded ?? 0) };
}

/** Fold every whole day strictly before `cutoff`, oldest first, each in isolation. */
export async function foldDaysBefore(
  db: Db,
  cutoff: Date,
  spec: DayFoldSpec,
  opts: { maxDays?: number } = {},
): Promise<DayFoldResult> {
  const boundary = cutoff.toISOString().slice(0, 10);
  const maxDays = opts.maxDays ?? DEFAULT_MAX_FOLD_DAYS;

  const dayRows = await db.execute(sql`
    SELECT DISTINCT ${sql.raw(spec.tsColumn)}::date::text AS day
      FROM ${sql.raw(spec.relation)}
     WHERE ${sql.raw(spec.tsColumn)} < ${boundary}::date
     ORDER BY 1
     LIMIT ${maxDays}
  `);
  const days = (Array.isArray(dayRows) ? dayRows : (dayRows as { rows?: unknown[] }).rows ?? [])
    .map((r) => String((r as { day: string }).day));

  const total: DayFoldResult = { days: 0, folded: 0, tallies: 0, skipped: [] };
  for (const day of days) {
    try {
      const { tallies, folded } = readFoldCounts(await spec.foldDay(db, day));
      total.days += 1;
      total.folded += folded;
      total.tallies += tallies;
    } catch (error) {
      total.skipped.push({ day, error: error instanceof Error ? error.message : 'fold failed' });
      reportCaughtError(error, {
        source: spec.source,
        operation: spec.operation,
        level: 'warning',
        context: { logMessage: `[cron:retention] ${spec.relation} fold left ${day} raw`, details: { relation: spec.relation, day } },
      });
    }
  }
  return total;
}
