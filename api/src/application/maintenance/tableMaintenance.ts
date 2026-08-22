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
 *     is bounded hard: one relation per run, worst first, from the SWEPT_TABLES
 *     registry only — every member of which is a diagnostic log with a best-effort
 *     writer, so blocking it briefly loses a log line at worst.
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
import { SWEPT_TABLES, sweptRelations, type SweptConnection } from './sweptTables';

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
    try {
      await vacuumRelation(dbFor(env, entry.connection), entry.relation);
      result.vacuumed.push(entry.relation);
    } catch (error) {
      result.failed.push({ relation: entry.relation, error: error instanceof Error ? error.message : 'VACUUM failed' });
      reportCaughtError(error, {
        source: 'application/maintenance/tableMaintenance.ts',
        operation: 'runTableVacuum',
        level: 'warning',
        context: { logMessage: `[cron:db-vacuum] VACUUM (ANALYZE) ${entry.relation} failed`, details: { relation: entry.relation } },
      });
    }
  }
  return result;
}

/** Heap must be at least this big before a rewrite is worth an exclusive lock. */
export const RECLAIM_MIN_HEAP_BYTES = 64 * 1024 * 1024;
/** …and at least this fraction of it must be estimated bloat. */
export const RECLAIM_MIN_BLOAT_RATIO = 0.5;
/** One rewrite per run, so a single tick can never chain exclusive locks. */
export const RECLAIM_MAX_PER_RUN = 1;

/**
 * Per-row overhead the bloat estimate adds to the summed column widths: 23 bytes of
 * tuple header rounded to the 24-byte MAXALIGN boundary, plus the 4-byte line pointer
 * in the page header. This is the standard estimate — it ignores per-page overhead and
 * alignment padding, so it reads slightly LOW, i.e. it under-reports bloat rather than
 * inventing it. That bias is the right one for a check that authorises a table rewrite.
 */
const ROW_OVERHEAD_BYTES = 28;

export interface RelationBloat {
  relation: string;
  connection: SweptConnection;
  /** Heap size on disk, excluding indexes and TOAST. */
  heapBytes: number;
  /** Estimated bytes of live tuple data. */
  liveBytes: number;
  /** heapBytes - liveBytes, floored at 0. */
  bloatBytes: number;
  /** bloatBytes / heapBytes, 0 when the heap is empty. */
  bloatRatio: number;
}

/**
 * Estimate bloat for the registered relations on one connection.
 *
 * Uses the planner's own statistics — `pg_class.reltuples` for the row count and the
 * summed `pg_stats.avg_width` for the row width — rather than `pgstattuple`, which is
 * an extension Neon does not install by default. The daily `VACUUM (ANALYZE)` above is
 * what keeps both inputs current; without it this would read stale and the reclaim
 * would either miss a bloated table or fire on a clean one.
 */
export async function measureBloat(env: Env, connection: SweptConnection): Promise<RelationBloat[]> {
  const relations = sweptRelations(connection);
  if (relations.length === 0) return [];
  const rows = (await dbFor(env, connection).execute(sql`
    SELECT c.relname                                   AS relation,
           pg_relation_size(c.oid)::bigint             AS "heapBytes",
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
  `)).rows as Array<{ relation: string; heapBytes: number | string; estRows: number | string; rowWidth: number | string }>;

  return rows.map((row) => {
    const heapBytes = Number(row.heapBytes ?? 0);
    const liveBytes = Number(row.estRows ?? 0) * (Number(row.rowWidth ?? 0) + ROW_OVERHEAD_BYTES);
    const bloatBytes = Math.max(0, heapBytes - liveBytes);
    return {
      relation: row.relation,
      connection,
      heapBytes,
      liveBytes,
      bloatBytes,
      bloatRatio: heapBytes > 0 ? bloatBytes / heapBytes : 0,
    };
  });
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
 * ({@link RECLAIM_MIN_HEAP_BYTES}) is what keeps a small, permanently-ratio-bloated
 * table from taking an exclusive lock every week for no benefit.
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
    .filter((m) => m.heapBytes >= RECLAIM_MIN_HEAP_BYTES && m.bloatRatio >= RECLAIM_MIN_BLOAT_RATIO)
    .sort((a, b) => b.bloatBytes - a.bloatBytes);

  for (const target of result.eligible.slice(0, RECLAIM_MAX_PER_RUN)) {
    try {
      await vacuumRelation(dbFor(env, target.connection), target.relation, { full: true });
      const [after] = (await measureBloat(env, target.connection)).filter((m) => m.relation === target.relation);
      result.reclaimed.push({ relation: target.relation, beforeBytes: target.heapBytes, afterBytes: after?.heapBytes ?? target.heapBytes });
    } catch (error) {
      result.failed.push({ relation: target.relation, error: error instanceof Error ? error.message : 'VACUUM FULL failed' });
      reportCaughtError(error, {
        source: 'application/maintenance/tableMaintenance.ts',
        operation: 'runBloatReclaim',
        level: 'warning',
        context: {
          logMessage: `[cron:db-reclaim] VACUUM (FULL, ANALYZE) ${target.relation} failed`,
          details: { relation: target.relation, heapBytes: target.heapBytes, bloatBytes: target.bloatBytes },
        },
      });
    }
  }
  return result;
}
