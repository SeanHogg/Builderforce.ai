import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * Retention purge — daily deletion of rows from append-only diagnostic/telemetry
 * tables that would otherwise grow unbounded. Run from the daily cron tick
 * (scheduled() in index.ts), mirroring the vendor-health cron.
 *
 * WHICH tables and HOW LONG each keeps is not decided here: it is the shared
 * {@link SWEPT_TABLES} registry, because the vacuum sweep that reclaims the space
 * these deletes free has to act on exactly the same set. Add a new unbounded log
 * table THERE — one place, one policy (DRY).
 *
 * Almost every table in that registry is a diagnostic/event log (no business records),
 * so deletion is safe and never cascades to domain data; the two that are not say so in
 * their own entry (see the registry's own header). The two policies that genuinely
 * cannot be registry entries — a row-level EXPIRY on domain data, and a COLUMN-level
 * window on a relation with live business writers — are declared alongside it in
 * {@link runRetentionPurge}.
 *
 * COMPRESSIBLE UNDER PRESSURE. The windows above are the steady-state policy. When an
 * endpoint approaches its storage ceiling the same pass runs again on SHORTER windows,
 * bounded per table by `pressureFloorDays` — see {@link RetentionOptions.pressure} and
 * `storagePressure.ts`, which is the only caller that passes one.
 */
import { buildDatabase, buildTransactionalDatabase, type Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { SWEPT_TABLES } from './sweptTables';
import { purgeExpiredMemories } from '../memory/memoryService';
import { EXECUTION_PAYLOAD_RETENTION_DAYS, redactStaleExecutionPayloads } from '../runtime/executionPayloadRetention';
import { DAY_MS } from '../../domain/shared/time';

const cutoff = (now: number, days: number) => new Date(now - days * DAY_MS);

export interface RetentionOptions {
  /**
   * How hard to compress every window, 0 = the declared policy and 1 = each table's
   * own `pressureFloorDays`. Interpolated linearly, so the tables with the most room
   * between window and floor give up the most days first, and a table that declares no
   * floor gives up none at all.
   *
   * Passed ONLY by the storage-pressure sweep. The daily tick leaves it undefined,
   * which is not the same as passing 0: `applyPressure` is then never consulted at all,
   * so the ordinary purge cannot be affected by a bug in the compression arithmetic.
   */
  pressure?: number;
}

/** The window a table is purged on at this pressure level, never below its floor and
 *  never below one day. A table with no `pressureFloorDays` is not compressible. */
export function compressedWindow(table: { retentionDays: number; pressureFloorDays?: number }, pressure: number | undefined): number {
  if (pressure == null || table.pressureFloorDays == null) return table.retentionDays;
  const clamped = Math.min(1, Math.max(0, pressure));
  const floor = Math.min(table.pressureFloorDays, table.retentionDays);
  return Math.max(1, Math.round(table.retentionDays - (table.retentionDays - floor) * clamped));
}

/**
 * Delete expired rows from every unbounded log table. Best-effort per table — a
 * failure on one is logged and does not block the others. `now` is injectable for
 * tests; defaults to the cron's wall clock.
 */
export async function runRetentionPurge(
  env: Env,
  now: number = Date.now(),
  db: Db = buildDatabase(env),
  options: RetentionOptions = {},
): Promise<void> {
  const transactionalDb = buildTransactionalDatabase(env);
  const dbFor = (connection: 'primary' | 'transactional'): Db => (connection === 'primary' ? db : transactionalDb);
  const windowFor = (table: { retentionDays: number; pressureFloorDays?: number }) => compressedWindow(table, options.pressure);

  const targets: Array<{ name: string; run: () => Promise<unknown> }> = [
    // Grain-level retention, FIRST — and the order is load-bearing, not tidiness. A
    // rollup folds a row into a summary and then deletes it; a purge deletes it
    // outright. Both claim rows past their window, so whichever runs first decides
    // whether that history survives as a tally or not at all. Running the purge first
    // would silently drop every row that was already past `retentionDays` when the
    // rollup was introduced — which on `tool_audit_events` was the oldest third of the
    // relation, exactly the backlog the fold exists to preserve.
    ...SWEPT_TABLES.flatMap((table) => (table.rollup
      ? table.connections.map((connection) => ({
        name: `${table.relation}.rollup@${connection}`,
        run: () => table.rollup!.run(dbFor(connection), cutoff(now, table.rollup!.afterDays)),
      }))
      : [])),
    // One target per (table, endpoint): a relation that exists on both databases is
    // purged on both, or the copy on the endpoint that lost its writer is never swept.
    ...SWEPT_TABLES.flatMap((table) => table.connections.map((connection) => ({
      name: `${table.relation}@${connection}`,
      run: () => table.purge(dbFor(connection), cutoff(now, windowFor(table))),
    }))),
    // Column-level retention, on its own shorter window. Runs AFTER every purge so it
    // never rewrites a row that was about to be deleted anyway.
    ...SWEPT_TABLES.flatMap((table) => (table.redact
      ? table.connections.map((connection) => ({
        name: `${table.relation}.payload@${connection}`,
        run: () => table.redact!.run(dbFor(connection), cutoff(now, table.redact!.afterDays)),
      }))
      : [])),
    // Lapsed agent memories (0371). NOT an age-based purge like the rest, and
    // deliberately NOT in SWEPT_TABLES: a fact expires when its own author said it
    // would, so the policy lives on the row, this only reclaims what recall already
    // stopped returning, and the relations behind it are domain data no maintenance
    // sweep may rewrite.
    { name: 'expired_memories', run: () => purgeExpiredMemories(env, db) },
    // The anonymous visitor journey (1111) used to be declared HERE, outside the
    // registry, on the reasoning that `activity_log` is the audit trail and the registry
    // "may neither purge wholesale nor rewrite" it. Half of that was right and the half
    // that was wrong cost the endpoint dearly: the standalone target was handed the
    // PRIMARY `db` while every row is written through `activityDatabase()` to the
    // operational sibling, so the only policy this table has deleted nothing, on the
    // endpoint that was actually filling up — and no vacuum ever followed the deletes it
    // was supposed to be making. It is now a registry entry with a predicate-scoped
    // `purge` and `reclaimable: false`: swept and vacuumed on BOTH endpoints, never
    // rewritten, and no longer able to point at the wrong database.
    // The dispatch payload on old runs. The OTHER kind of non-registry policy: column-level
    // on domain data. `executions` is business data with twelve cascading children and
    // live writers, so the sweep may neither delete from it nor rewrite it — but one
    // column on it was 29 MB that no reader of a 30-day-old run can reach.
    {
      name: 'execution_payloads',
      run: () => redactStaleExecutionPayloads(db, cutoff(now, EXECUTION_PAYLOAD_RETENTION_DAYS)),
    },
  ];

  for (const t of targets) {
    try {
      await t.run();
    } catch (err) {
      reportCaughtError(err, { source: "application/maintenance/retentionPurge.ts", operation: "runRetentionPurge", context: { logMessage: `[cron:retention] purge ${t.name} failed`, details: err } });
    }
  }
}
