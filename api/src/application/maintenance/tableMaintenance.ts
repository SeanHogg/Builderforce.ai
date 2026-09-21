/**
 * tableMaintenance — the vacuum half of the log-table policy.
 *
 * THE PROBLEM RETENTION DOES NOT SOLVE. Deleting a row does not return its page to
 * the operating system; it marks the tuple dead and, once autovacuum runs, leaves the
 * page reusable BY THAT TABLE. On a high-write append-only feed the reuse never
 * catches up with the churn, so the relation keeps its high-water mark forever. That
 * is exactly how `manager_actions` came to hold 46k live rows (~24 MB of real data,
 * zero dead tuples) inside a 593 MB relation and put the whole database over the Neon
 * Free 512 MB ceiling — retention was already in force and reclaimed none of it.
 *
 * TWO OPERATIONS, DELIBERATELY SEPARATE.
 *
 *   • {@link runTableVacuum} — plain `VACUUM (ANALYZE)`, daily, right after the
 *     retention purge. Takes no exclusive lock, so it is safe beside live traffic. It
 *     does not shrink the file, but it keeps the free-space map accurate so the table
 *     REUSES its pages instead of extending, which is what stops the bloat being
 *     re-earned. The `ANALYZE` half also keeps `reltuples`/`pg_stats` fresh — the
 *     inputs the bloat estimate below depends on.
 *
 *   • {@link runBloatReclaim} — `VACUUM (FULL, ANALYZE)`, weekly, and ONLY for a
 *     relation whose bloat is past both thresholds. This rewrites the table and does
 *     return the space, at the cost of an ACCESS EXCLUSIVE lock for the duration. It
 *     is bounded hard: one relation per endpoint per run, worst first, and only from the registry
 *     entries that declare themselves `reclaimable` — every one of which is a diagnostic
 *     log with a best-effort writer, so blocking it briefly loses a log line at worst.
 *     `activity_log` is the exception that made the flag necessary: it needs the vacuum
 *     above and must never be rewritten, because what a blocked write loses there is an
 *     audit line.
 *
 * This is what replaces "pending the operator running a one-time VACUUM FULL in the
 * Neon console": the reclaim happens on the next weekly tick and keeps happening.
 * NOTE on Neon specifically: after a rewrite the LOGICAL size drops immediately, but
 * BILLED storage lags until the PITR window rolls past it, because the old pages are
 * still reachable history.
 */
import { sql } from 'drizzle-orm';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { buildDatabase, buildTransactionalDatabase, type Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { SWEPT_TABLES, reclaimableRelations, type SweptConnection } from './sweptTables';

/**
 * Guard on any relation name interpolated into a maintenance statement. `VACUUM` takes
 * no bind parameters, so the name is concatenated and this is the only thing standing
 * between an operator-supplied table and injection. Deliberately stricter than
 * Postgres allows: lower-case identifiers only, which is every table this codebase has.
 */
export function isSafeRelationName(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z_][a-z0-9_]{0,62}$/.test(value);
}

/**
 * Run a vacuum. `relation` omitted = the whole database. THE single place that builds
 * a VACUUM statement, so the quoting rule and the safety check cannot diverge between
 * the cron sweep and the superadmin maintenance route.
 */
export async function vacuumRelation(db: Db, relation?: string, options: { full?: boolean } = {}): Promise<void> {
  if (relation != null && !isSafeRelationName(relation)) {
    throw new Error(`Unsafe relation name for VACUUM: ${String(relation)}`);
  }
  const mode = options.full ? 'FULL, ANALYZE' : 'ANALYZE';
  await db.execute(sql.raw(relation ? `VACUUM (${mode}) "${relation}"` : `VACUUM (${mode})`));
}

function dbFor(env: Env, connection: SweptConnection): Db {
  return connection === 'primary' ? buildDatabase(env) : buildTransactionalDatabase(env);
}

export interface TableVacuumResult {
  vacuumed: string[];
  failed: Array<{ relation: string; error: string }>;
}

/**
 * Plain `VACUUM (ANALYZE)` over every registered log table, on both connections.
 * Best-effort per relation — one failure is logged and never blocks the rest, exactly
 * as the retention purge behaves, because a maintenance sweep that aborts halfway is
 * worse than one that reports a partial pass.
 */
export async function runTableVacuum(env: Env): Promise<TableVacuumResult> {
  const result: TableVacuumResult = { vacuumed: [], failed: [] };
  for (const entry of SWEPT_TABLES) {
    for (const connection of entry.connections) {
      try {
        await vacuumRelation(dbFor(env, connection), entry.relation);
        result.vacuumed.push(entry.relation);
      } catch (error) {
        result.failed.push({ relation: entry.relation, error: error instanceof Error ? error.message : 'VACUUM failed' });
        reportCaughtError(error, {
          source: 'application/maintenance/tableMaintenance.ts',
          operation: 'runTableVacuum',
          level: 'warning',
          context: { logMessage: `[cron:db-vacuum] VACUUM (ANALYZE) ${entry.relation} failed on ${connection}`, details: { relation: entry.relation, connection } },
        });
      }
    }
  }
  return result;
}

/** The table — heap AND TOAST, not indexes — must be at least this big before a rewrite
 *  is worth an exclusive lock. */
export const RECLAIM_MIN_TABLE_BYTES = 64 * 1024 * 1024;
/** …and at least this fraction of it must be estimated bloat. */
export const RECLAIM_MIN_BLOAT_RATIO = 0.5;
/**
 * One rewrite per ENDPOINT per run.
 *
 * Per endpoint rather than per run because the reason for the bound is lock chaining, and
 * locks do not chain across separate databases. A global limit of one let the fuller
 * endpoint's worst table starve the other endpoint indefinitely — which is precisely when
 * both are near the ceiling and both need the rewrite.
 */
export const RECLAIM_MAX_PER_CONNECTION = 1;
/** Percentage of pages the live-size sample reads. Small on purpose: the answer only has
 *  to separate "mostly empty" from "mostly full", and the sample detoasts what it reads. */
export const LIVE_SAMPLE_PERCENT = 5;
/** Below this many sampled rows the average is noise, and the planner estimate is used. */
export const LIVE_SAMPLE_MIN_ROWS = 50;

/**
 * Per-row overhead the planner-statistics estimate adds to the summed column widths: 23
 * bytes of tuple header rounded to the 24-byte MAXALIGN boundary, plus the 4-byte line
 * pointer. It ignores per-page overhead and padding, so it reads slightly LOW — it
 * under-reports bloat rather than inventing it, the right bias for a check that
 * authorises a rewrite.
 */
const ROW_OVERHEAD_BYTES = 28;
/** The line pointer alone — `pg_column_size(t.*)` already counts the tuple header. */
const LINE_POINTER_BYTES = 4;

export interface RelationBloat {
  relation: string;
  connection: SweptConnection;
  /** Heap + TOAST on disk (`pg_table_size`), excluding indexes. */
  tableBytes: number;
  /** Estimated bytes of live data, heap and TOAST together. */
  liveBytes: number;
  /** tableBytes - liveBytes, floored at 0. */
  bloatBytes: number;
  /** bloatBytes / tableBytes, 0 when the table is empty. */
  bloatRatio: number;
  /** Where `liveBytes` came from: a page sample, or the planner's column widths. */
  estimate: 'sample' | 'stats';
}

/**
 * Estimate bloat for the rewritable relations on one connection.
 *
 * WHY THE TABLE AND NOT THE HEAP. This used to measure `pg_relation_size` — the heap
 * only — and the omission was not academic. A log table whose weight is large text is
 * stored almost entirely in TOAST: `llm_traces` on 2026-09-16 was 241 MB with a 29 MB
 * heap and 209 MB of TOAST, so it sat under the size floor forever and could never be
 * chosen however much of its body text had been blanked. `pg_table_size` is heap + TOAST.
 *
 * WHY A SAMPLE AND NOT JUST `pg_stats`. The planner's `avg_width` cannot see out-of-line
 * values, so a stats estimate of live bytes is blind to exactly the part that was just
 * missing. For any relation big enough to be a candidate, live size is instead measured
 * from a `TABLESAMPLE` of its pages: `pg_column_size(t.*)` builds the whole row, which
 * pulls its TOASTed values inline (still compressed, as TOAST stores them), so the
 * average row it reports is the real on-disk cost of a live row. Five percent of pages is
 * enough to tell a table that is mostly free space from one that is mostly data, which is
 * the only thing the thresholds ask. Smaller relations, and samples too thin to trust,
 * fall back to the statistics — they cannot clear the size floor either way.
 *
 * Neon ships no `pgstattuple`, which would answer this exactly; the daily
 * `VACUUM (ANALYZE)` keeps `reltuples` current for the multiplication below.
 */
export async function measureBloat(env: Env, connection: SweptConnection): Promise<RelationBloat[]> {
  // Only what the rewrite is ALLOWED to act on. Measuring a relation this sweep may never
  // touch would put it at the top of `eligible` — it is the biggest and the most bloated
  // precisely because it is never rewritten — and every run would then report a candidate
  // it silently skips, which reads as the reclaim being broken.
  const relations = reclaimableRelations(connection).filter(isSafeRelationName);
  if (relations.length === 0) return [];
  const db = dbFor(env, connection);
  const rows = (await db.execute(sql`
    SELECT c.relname                                   AS relation,
           pg_table_size(c.oid)::bigint                AS "tableBytes",
           GREATEST(c.reltuples, 0)::bigint            AS "estRows",
           COALESCE(s.width, 0)::bigint                AS "rowWidth"
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN LATERAL (
        SELECT SUM(avg_width)::bigint AS width
          FROM pg_stats
         WHERE schemaname = n.nspname AND tablename = c.relname
      ) s ON TRUE
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND c.relname IN (${sql.join(relations.map((r) => sql`${r}`), sql`, `)})
  `)).rows as Array<{ relation: string; tableBytes: number | string; estRows: number | string; rowWidth: number | string }>;

  const measured: RelationBloat[] = [];
  for (const row of rows) {
    const tableBytes = Number(row.tableBytes ?? 0);
    const estRows = Number(row.estRows ?? 0);
    let liveBytes = estRows * (Number(row.rowWidth ?? 0) + ROW_OVERHEAD_BYTES);
    let estimate: RelationBloat['estimate'] = 'stats';
    // Sample only what could actually be chosen — the sample detoasts what it reads, and a
    // relation under the floor is ineligible whatever it reports.
    if (tableBytes >= RECLAIM_MIN_TABLE_BYTES && isSafeRelationName(row.relation)) {
      const [sample] = (await db.execute(sql.raw(
        `SELECT COALESCE(AVG(pg_column_size(t.*)), 0)::bigint AS "avgRowBytes", COUNT(*)::int AS "sampled"`
        + ` FROM "${row.relation}" t TABLESAMPLE SYSTEM (${LIVE_SAMPLE_PERCENT})`,
      ))).rows as Array<{ avgRowBytes: number | string; sampled: number | string }>;
      if (Number(sample?.sampled ?? 0) >= LIVE_SAMPLE_MIN_ROWS) {
        liveBytes = estRows * (Number(sample?.avgRowBytes ?? 0) + LINE_POINTER_BYTES);
        estimate = 'sample';
      }
    }
    const bloatBytes = Math.max(0, tableBytes - liveBytes);
    measured.push({
      relation: row.relation,
      connection,
      tableBytes,
      liveBytes,
      bloatBytes,
      bloatRatio: tableBytes > 0 ? bloatBytes / tableBytes : 0,
      estimate,
    });
  }
  return measured;
}

export interface BloatReclaimResult {
  /** Relations measured across both connections. */
  inspected: number;
  /** Relations past both thresholds — may exceed what was reclaimed this run. */
  eligible: RelationBloat[];
  /** What was actually rewritten, with the size on either side. */
  reclaimed: Array<{ relation: string; beforeBytes: number; afterBytes: number }>;
  failed: Array<{ relation: string; error: string }>;
}

/**
 * Rewrite the single worst bloated log table when it is past both thresholds.
 *
 * Ordering is by ABSOLUTE bloat, not ratio: a 400 MB relation that is 60% bloat is the
 * one costing money, while a 2 MB one at 95% is noise. The absolute floor
 * ({@link RECLAIM_MIN_TABLE_BYTES}) is what keeps a small, permanently-ratio-bloated
 * table from taking an exclusive lock every week for no benefit. The worst table is
 * chosen PER ENDPOINT — see {@link RECLAIM_MAX_PER_CONNECTION}.
 */
export async function runBloatReclaim(env: Env): Promise<BloatReclaimResult> {
  const result: BloatReclaimResult = { inspected: 0, eligible: [], reclaimed: [], failed: [] };
  const connections: SweptConnection[] = ['primary', 'transactional'];
  const measured: RelationBloat[] = [];
  for (const connection of connections) {
    try {
      measured.push(...await measureBloat(env, connection));
    } catch (error) {
      result.failed.push({ relation: `${connection}:*`, error: error instanceof Error ? error.message : 'bloat measurement failed' });
      reportCaughtError(error, {
        source: 'application/maintenance/tableMaintenance.ts',
        operation: 'runBloatReclaim',
        level: 'warning',
        context: { logMessage: `[cron:db-reclaim] bloat measurement failed on ${connection}`, details: { connection } },
      });
    }
  }
  result.inspected = measured.length;
  result.eligible = measured
    .filter((m) => m.tableBytes >= RECLAIM_MIN_TABLE_BYTES && m.bloatRatio >= RECLAIM_MIN_BLOAT_RATIO)
    .sort((a, b) => b.bloatBytes - a.bloatBytes);

  const targets = connections.flatMap((connection) => result.eligible
    .filter((e) => e.connection === connection)
    .slice(0, RECLAIM_MAX_PER_CONNECTION));

  for (const target of targets) {
    try {
      await vacuumRelation(dbFor(env, target.connection), target.relation, { full: true });
      const [after] = (await measureBloat(env, target.connection)).filter((m) => m.relation === target.relation);
      result.reclaimed.push({ relation: target.relation, beforeBytes: target.tableBytes, afterBytes: after?.tableBytes ?? target.tableBytes });
    } catch (error) {
      result.failed.push({ relation: target.relation, error: error instanceof Error ? error.message : 'VACUUM FULL failed' });
      reportCaughtError(error, {
        source: 'application/maintenance/tableMaintenance.ts',
        operation: 'runBloatReclaim',
        level: 'warning',
        context: {
          logMessage: `[cron:db-reclaim] VACUUM (FULL, ANALYZE) ${target.relation} failed`,
          details: { relation: target.relation, tableBytes: target.tableBytes, bloatBytes: target.bloatBytes },
        },
      });
    }
  }
  return result;
}
