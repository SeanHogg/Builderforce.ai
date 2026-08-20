/**
 * The metric-rollup PRIMITIVE — one engine, seventeen writers.
 *
 * ── THE DEFECT THIS CLOSES ──────────────────────────────────────────────────
 * `DOMAIN_MANIFEST` declares 45 charted metric keys across seventeen domains.
 * Before this module, exactly three domains had a writer — `financeRollup.ts`,
 * `operationsRollup.ts` and `legalRollup.ts` — and the other fourteen were
 * declared by the kernel, charted by every seat surface, and produced by
 * nothing. `founderCanvasPrompt.ts` teaches the model BY NAME to bind a
 * `liveMetric` to `growth.leads`; the refresh then read a key with no producer.
 * The flagship "live, not stale" promise was an empty read dressed as a live
 * one for a founder whose published site was collecting real signups.
 *
 * ── WHY AN ENGINE AND NOT FOURTEEN MORE COPIES ──────────────────────────────
 * The three writers that existed had already copied `tableExists`, `rowCount`,
 * the `{written, facts, skipped}` result shape, the `INSERT INTO metric_facts …
 * ON CONFLICT (uq_metric_facts_point) DO UPDATE` envelope and the absent-table
 * skip between them — three times. Fourteen more would be that duplication
 * seventeen-fold, which is precisely what the platform's DRY rule forbids: the
 * same logic in 2+ places means extract the primitive and migrate every
 * duplicate in the same pass. So the per-domain difference is DATA — a list of
 * `MetricSpec`s naming a key, the tables it needs and the SELECT that produces
 * it — and adding a seat's numbers is a module of specs, never another copy of
 * the plumbing.
 *
 * ── THE RULE THAT KEEPS EVERY NUMBER HONEST ─────────────────────────────────
 * Inherited verbatim from `financeRollup.ts`, and it is why this engine has no
 * zero-fill anywhere: a fact is written ONLY where the rows behind it exist.
 * `trigger` objects fire on these keys with `below` comparators, so a
 * fabricated 0 for a tenant that has simply never recorded anything reads as a
 * catastrophe and fires every alarm on the board. An absent fact keeps the
 * honest `no_data` every reader already knows how to render.
 *
 * ── ATTRIBUTION ─────────────────────────────────────────────────────────────
 * `metric_facts.object_id` exists, has its own index and an FK to `objects`,
 * and nothing ever populated it — so no outcome could be traced back to the
 * artifact that caused it. `fact()` takes an `objectId` and a `dimensionKey`
 * together, and they are inseparable for a reason: `uq_metric_facts_point` does
 * NOT include `object_id`, so an attributed row reusing the tenant-wide
 * `dimension_key` of `''` would COLLIDE with the total and overwrite it. Every
 * attributed series therefore rides its own dimension key, which is also what
 * lets the total and its per-artifact breakdown be read from one series without
 * either being able to contradict the other.
 *
 * ── COST ────────────────────────────────────────────────────────────────────
 * One `information_schema` read per sweep for the whole pass — replacing the
 * per-metric `to_regclass` probe the three hand-written rollups each did — then
 * one statement per metric, each a grouped aggregate upserting on the point key.
 * No per-tenant fan-out and no N+1. The sweep is work-gated upstream by
 * `cronWorkSignal`, so an idle workspace costs nothing.
 */

import { sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Domain } from './ObjectRegistry';

/** `metric_facts.bucket`. */
export type Bucket = 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'total';

/**
 * One upsert into `metric_facts`, stated as its parts rather than as SQL.
 *
 * `tail` is the FROM/JOIN/WHERE/GROUP BY/HAVING half — everything after the
 * projected columns — because that is the only part that differs between a
 * count of orders and an average of pulse scores.
 */
export interface FactSpec {
  metric: string;
  bucket: Bucket;
  /** Rendered on the tile beside the number. Never a unit the value is not in. */
  unit: string;
  /** The tenant column of the aggregate. */
  tenant: SQL;
  /** The bucket timestamp expression. */
  bucketAt: SQL;
  /** The aggregate itself. */
  value: SQL;
  /** FROM … WHERE … GROUP BY … — everything after the projection. */
  tail: SQL;
  /** The slice, as JSONB. Present exactly when `dimensionKey` is. */
  dimension?: SQL;
  /** Canonical slice key. MUST be distinct from '' on any dimensioned row. */
  dimensionKey?: SQL;
  /** The `objects` row this fact is ATTRIBUTABLE to. Requires `dimensionKey`. */
  objectId?: SQL;
}

/**
 * The `INSERT … SELECT … ON CONFLICT` envelope, written once.
 *
 * `DO UPDATE` re-states `unit`, `dimension` and `object_id` as well as `value`:
 * a metric whose attribution or slice is corrected must correct the row it
 * already wrote, not leave a stale pointer beside a fresh number.
 */
export function fact(spec: FactSpec): SQL {
  if (spec.objectId && !spec.dimensionKey) {
    // Not a runtime concern in practice — every caller is a module-load constant —
    // but an attributed row sharing the tenant total's '' key would silently
    // overwrite the total under `uq_metric_facts_point`, which is the single
    // worst thing this file could allow.
    throw new Error(`${spec.metric}: an attributed fact must carry its own dimensionKey`);
  }
  return sql`
    INSERT INTO metric_facts (tenant_id, metric, bucket, bucket_at, dimension, dimension_key, object_id, value, unit, computed_at)
    SELECT ${spec.tenant},
           ${spec.metric},
           ${spec.bucket},
           ${spec.bucketAt},
           ${spec.dimension ?? sql`NULL::jsonb`},
           ${spec.dimensionKey ?? sql`''`},
           ${spec.objectId ?? sql`NULL::uuid`},
           ${spec.value},
           ${spec.unit},
           NOW()
    ${spec.tail}
    ON CONFLICT (tenant_id, metric, bucket, bucket_at, dimension_key) DO UPDATE
      SET value       = EXCLUDED.value,
          unit        = EXCLUDED.unit,
          dimension   = EXCLUDED.dimension,
          object_id   = EXCLUDED.object_id,
          computed_at = NOW()
  `;
}

/** The tables a rollup found on this database. */
export type PresentTables = ReadonlySet<string>;

/**
 * One metric a seat charts, and how to produce it.
 *
 * `requires` is the honest half: a projection map written against the target
 * schema lands ahead of some of it, and a metric whose source table does not
 * exist yet is SKIPPED with a reason rather than failing the whole sweep and
 * taking the other sixteen domains down with it.
 */
export interface MetricSpec {
  /** The `metric_facts.metric` key. Asserted against `DOMAIN_MANIFEST`. */
  key: string;
  /** Every table that must exist. Any missing means skipped, not fatal. */
  requires: readonly string[];
  /**
   * The statements. Receives the present-table set so a metric that UNIONs
   * several optional registers (legal's renewals) can build over what exists.
   * `null` = nothing to write on this database.
   */
  build: (present: PresentTables) => SQL | SQL[] | null;
}

/** A domain's writer: its specs, plus any derivation its aggregates read. */
export interface DomainRollup {
  domain: Domain;
  metrics: readonly MetricSpec[];
  /**
   * Work that must land BEFORE the aggregates run, because they read what it
   * writes (operations recomputes each work order's first-time-fix evidence
   * from its visits, then counts the column it just corrected). Returns named
   * counters for the sweep's log line.
   */
  prepare?: (db: Db, present: PresentTables) => Promise<Record<string, number>>;
}

export interface RollupResult {
  domain: Domain;
  /** metric key → rows upserted. */
  written: Record<string, number>;
  facts: number;
  /** Metrics skipped because a source table is absent in this environment. */
  skipped: string[];
  /** Counters from `prepare`, for the log line. */
  extra: Record<string, number>;
}

function rowCount(result: unknown): number {
  return Number((result as { rowCount?: number }).rowCount ?? 0);
}

/**
 * Every table on this database, in ONE read.
 *
 * The three hand-written rollups each ran a `to_regclass` probe per metric —
 * seventeen domains doing that would be ~50 round trips before a single fact was
 * written. The whole catalogue is a few hundred rows and answers all of them.
 */
export async function presentTables(db: Db): Promise<PresentTables> {
  const result = await db.execute(sql`
    SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
  `);
  const rows = (result as unknown as { rows?: Array<{ table_name?: string }> }).rows
    ?? (result as unknown as Array<{ table_name?: string }>);
  return new Set(rows.map((r) => r.table_name).filter((n): n is string => !!n));
}

/** Run ONE domain's writer. */
export async function runDomainRollup(
  db: Db,
  rollup: DomainRollup,
  present: PresentTables,
): Promise<RollupResult> {
  const written: Record<string, number> = {};
  const skipped: string[] = [];
  let extra: Record<string, number> = {};

  if (rollup.prepare) extra = await rollup.prepare(db, present);

  for (const spec of rollup.metrics) {
    const missing = spec.requires.filter((table) => !present.has(table));
    if (missing.length) {
      skipped.push(`${spec.key} (${missing.join(', ')} absent)`);
      continue;
    }
    const built = spec.build(present);
    if (!built) {
      skipped.push(`${spec.key} (no source on this database)`);
      continue;
    }
    let count = 0;
    for (const statement of Array.isArray(built) ? built : [built]) {
      count += rowCount(await db.execute(statement));
    }
    written[spec.key] = (written[spec.key] ?? 0) + count;
  }

  return {
    domain: rollup.domain,
    written,
    facts: Object.values(written).reduce((sum, n) => sum + n, 0),
    skipped,
    extra,
  };
}

/** Run several writers over ONE catalogue read. */
export async function runRollups(db: Db, rollups: readonly DomainRollup[]): Promise<RollupResult[]> {
  const present = await presentTables(db);
  const out: RollupResult[] = [];
  for (const rollup of rollups) out.push(await runDomainRollup(db, rollup, present));
  return out;
}

/**
 * The `objects` row for a projected entity, as a correlated subquery.
 *
 * Attribution is a lookup into the registry the `object-registry` sweep
 * refreshes immediately before this one — which is why the ordering in
 * `CRON_SWEEPS` is load-bearing rather than cosmetic. It resolves to NULL for
 * an artifact the registry has not caught up with yet, and the fact is written
 * anyway: an unattributed true number beats dropping a row to preserve a
 * pointer.
 */
export function objectRef(kind: string, tenant: SQL, refId: SQL): SQL {
  return sql`(SELECT o.id FROM objects o WHERE o.tenant_id = ${tenant} AND o.kind = ${kind} AND o.ref_id = ${refId} LIMIT 1)`;
}
