/**
 * The WRITER for `operations.*` metric facts — and for the one derived column the
 * operations schema declares.
 *
 * ── WHY THIS EXISTS AT ALL ───────────────────────────────────────────────────────
 * `financeRollup.ts` records the defect it was built to close: `DOMAIN_MANIFEST`
 * declared three finance metrics, three surfaces read them by name, and nothing on the
 * platform ever INSERTED one — a live promise over an empty read. Adding a sixteenth
 * seat with three declared metrics and no writer would have recreated that defect
 * knowingly, on the day it is quoted. So the seat arrives with its numbers real:
 *
 *   • `operations.open_work_orders` — the backlog, daily. The number a service business
 *     opens its morning on.
 *   • `operations.first_time_fix`   — the share of completed jobs fixed on ONE visit,
 *     monthly. The headline operational metric of every vertical this domain serves:
 *     a second visit is a doubled cost against a single invoice.
 *   • `operations.sla_breaches`     — jobs that missed their contracted date, daily.
 *
 * ── AND WHY IT WRITES A COLUMN, NOT ONLY FACTS ───────────────────────────────────
 * `work_orders.first_time_fix` is EVIDENCE, not an opinion, and its value is a property
 * of the visits underneath it: one attendance that resolved the job, or more than one.
 * The generic entity writer can set any writable column, so a client CAN assert it —
 * which is exactly why this recomputes it from `work_order_visits` on every pass. An
 * asserted value is corrected rather than trusted, which is the honest version of the
 * rule (nothing here can make the column physically unwritable, and claiming otherwise
 * in a comment would be worse than the gap).
 *
 * ── THE RULE THAT KEEPS THE NUMBERS HONEST ──────────────────────────────────────
 * Same as finance: a fact is written ONLY where rows exist, and there is no zero-fill.
 * A first-time-fix rate of 0 renders as a catastrophically broken operation, and
 * writing one for a tenant that has simply never completed a job would turn an absent
 * number into an alarming one — and `trigger` objects fire on these keys.
 *
 * ── COST ────────────────────────────────────────────────────────────────────────
 * Four statements, each a grouped aggregate over an indexed range, upserting on
 * `uq_metric_facts_point`. No per-tenant fan-out and no N+1, per the caching and
 * performance standard; the sweep is gated by `cronWorkSignal` upstream so an idle
 * workspace costs nothing.
 */

import { sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';

export interface OperationsRollupResult {
  /** metric key → rows upserted. */
  written: Record<string, number>;
  /** Total facts written, for the sweep's log line. */
  facts: number;
  /** Work orders whose `first_time_fix` was (re)computed from their visits. */
  fixesResolved: number;
  /** Metrics skipped because their source table is absent in this environment. */
  skipped: string[];
}

/** How many months of first-time-fix history each pass recomputes. */
const WINDOW_MONTHS = 18;
/** How many days of backlog/breach history each pass recomputes. */
const WINDOW_DAYS = 90;

/** Terminal states. An order that was cancelled is not backlog and is not a breach:
 *  counting it as either is how a cleaned-up queue looks like a failing one. */
const CLOSED = ['completed', 'cancelled'] as const;

async function tableExists(db: Db, table: string): Promise<boolean> {
  const result = await db.execute(sql`SELECT to_regclass(${`public.${table}`}) IS NOT NULL AS present`);
  const rows = (result as unknown as { rows?: Array<{ present?: boolean }> }).rows ?? [];
  return rows[0]?.present === true;
}

function rowCount(result: unknown): number {
  return Number((result as { rowCount?: number }).rowCount ?? 0);
}

/**
 * Recompute the operations series into `metric_facts`, and the first-time-fix
 * evidence onto the work orders it is derived from.
 *
 * Idempotent: every statement upserts on `(tenant_id, metric, bucket, bucket_at,
 * dimension_key)`, so running twice in a day corrects rather than doubles.
 */
export async function runOperationsRollup(db: Db): Promise<OperationsRollupResult> {
  const written: Record<string, number> = {};
  const skipped: string[] = [];
  let fixesResolved = 0;

  if (!(await tableExists(db, 'work_orders'))) {
    return { written, facts: 0, fixesResolved: 0, skipped: ['operations.* (work_orders absent)'] };
  }

  // ── The derived column, before the metric that reads it ────────────────────────
  //
  // First-time fix = the job is completed AND exactly one visit actually reached the
  // site. `check_in_at IS NOT NULL` rather than a count of visit ROWS is the whole
  // subtlety: a visit that was booked and cancelled, or one where nobody could get in,
  // did not consume a second attendance and must not count against the engineer who
  // fixed it on their only trip. An order with NO recorded attendance stays NULL —
  // unknowable is not the same as false.
  if (await tableExists(db, 'work_order_visits')) {
    const resolved = await db.execute(sql`
      UPDATE work_orders o
         -- Parenthesised deliberately: SET col = a = b is legal and reads as an
         -- assignment of a comparison, which is a sentence no reviewer should have to
         -- parse twice. updated_at is NOT touched — recomputing evidence must not
         -- reorder the seat's "recently touched" list under somebody's cursor.
         SET first_time_fix = (v.attended = 1)
        FROM (
          SELECT work_order_id, COUNT(*) FILTER (WHERE check_in_at IS NOT NULL) AS attended
            FROM work_order_visits
           GROUP BY work_order_id
        ) AS v
       WHERE v.work_order_id = o.id
         AND o.completed_at IS NOT NULL
         AND v.attended > 0
         AND (o.first_time_fix IS DISTINCT FROM (v.attended = 1))
    `);
    fixesResolved = rowCount(resolved);
  } else {
    skipped.push('first_time_fix (work_order_visits absent)');
  }

  // ── The backlog, daily ─────────────────────────────────────────────────────────
  //
  // Bucketed on the day the order was RAISED rather than on today, so the series is a
  // recomputable history: a single "open right now" counter cannot be reconciled a week
  // later, which is the argument `finance.cash` already makes for a running balance.
  const open = await db.execute(sql`
    INSERT INTO metric_facts (tenant_id, metric, bucket, bucket_at, dimension_key, value, unit, computed_at)
    SELECT o.tenant_id,
           'operations.open_work_orders',
           'day',
           DATE_TRUNC('day', o.created_at),
           '',
           COUNT(*),
           'orders',
           NOW()
      FROM work_orders o
     WHERE o.tenant_id IS NOT NULL
       AND o.status NOT IN (${sql.join(CLOSED.map((s) => sql`${s}`), sql`, `)})
       AND o.created_at >= DATE_TRUNC('day', NOW()) - (${WINDOW_DAYS} * INTERVAL '1 day')
     GROUP BY o.tenant_id, DATE_TRUNC('day', o.created_at)
    ON CONFLICT (tenant_id, metric, bucket, bucket_at, dimension_key) DO UPDATE
      SET value = EXCLUDED.value, unit = EXCLUDED.unit, computed_at = NOW()
  `);
  written['operations.open_work_orders'] = rowCount(open);

  // Sliced by discipline as a DIMENSION of the same metric rather than a second metric —
  // which is what `dimension_key` is for, and what makes "which trade is drowning?"
  // answerable from the series the tile already reads.
  const openByDiscipline = await db.execute(sql`
    INSERT INTO metric_facts (tenant_id, metric, bucket, bucket_at, dimension, dimension_key, value, unit, computed_at)
    SELECT o.tenant_id,
           'operations.open_work_orders',
           'day',
           DATE_TRUNC('day', o.created_at),
           JSONB_BUILD_OBJECT('discipline', o.discipline),
           'discipline:' || o.discipline,
           COUNT(*),
           'orders',
           NOW()
      FROM work_orders o
     WHERE o.tenant_id IS NOT NULL
       AND o.status NOT IN (${sql.join(CLOSED.map((s) => sql`${s}`), sql`, `)})
       AND o.created_at >= DATE_TRUNC('day', NOW()) - (${WINDOW_DAYS} * INTERVAL '1 day')
     GROUP BY o.tenant_id, o.discipline, DATE_TRUNC('day', o.created_at)
    ON CONFLICT (tenant_id, metric, bucket, bucket_at, dimension_key) DO UPDATE
      SET value = EXCLUDED.value, unit = EXCLUDED.unit, computed_at = NOW()
  `);
  written['operations.open_work_orders/discipline'] = rowCount(openByDiscipline);

  // ── First-time fix, monthly, as a percentage ───────────────────────────────────
  //
  // Monthly rather than daily because the denominator matters: at a daily grain a
  // two-job Tuesday reads as 50% or 100% and the line is noise. Only orders whose
  // first_time_fix is KNOWN are counted — an unattended job is absent from both halves
  // rather than dragging the rate down.
  const ftf = await db.execute(sql`
    INSERT INTO metric_facts (tenant_id, metric, bucket, bucket_at, dimension_key, value, unit, computed_at)
    SELECT o.tenant_id,
           'operations.first_time_fix',
           'month',
           DATE_TRUNC('month', o.completed_at),
           '',
           ROUND(100.0 * COUNT(*) FILTER (WHERE o.first_time_fix) / COUNT(*), 2),
           'percent',
           NOW()
      FROM work_orders o
     WHERE o.tenant_id IS NOT NULL
       AND o.completed_at IS NOT NULL
       AND o.first_time_fix IS NOT NULL
       AND o.completed_at >= DATE_TRUNC('month', NOW()) - (${WINDOW_MONTHS} * INTERVAL '1 month')
     GROUP BY o.tenant_id, DATE_TRUNC('month', o.completed_at)
    ON CONFLICT (tenant_id, metric, bucket, bucket_at, dimension_key) DO UPDATE
      SET value = EXCLUDED.value, unit = EXCLUDED.unit, computed_at = NOW()
  `);
  written['operations.first_time_fix'] = rowCount(ftf);

  // ── SLA breaches, daily ────────────────────────────────────────────────────────
  //
  // Two ways to breach and they are ONE fact: finished late, or still open past the
  // date. Counting only the first understates the number precisely when it matters
  // most — during the outage that is currently running — so an open, overdue job is a
  // breach the day it becomes one, bucketed on the date it was DUE.
  const breaches = await db.execute(sql`
    INSERT INTO metric_facts (tenant_id, metric, bucket, bucket_at, dimension_key, value, unit, computed_at)
    SELECT o.tenant_id,
           'operations.sla_breaches',
           'day',
           DATE_TRUNC('day', o.sla_due_at),
           '',
           COUNT(*),
           'orders',
           NOW()
      FROM work_orders o
     WHERE o.tenant_id IS NOT NULL
       AND o.sla_due_at IS NOT NULL
       AND o.sla_due_at >= DATE_TRUNC('day', NOW()) - (${WINDOW_DAYS} * INTERVAL '1 day')
       AND o.status <> 'cancelled'
       AND (
         (o.completed_at IS NOT NULL AND o.completed_at > o.sla_due_at)
         OR (o.completed_at IS NULL AND o.sla_due_at < NOW())
       )
     GROUP BY o.tenant_id, DATE_TRUNC('day', o.sla_due_at)
    ON CONFLICT (tenant_id, metric, bucket, bucket_at, dimension_key) DO UPDATE
      SET value = EXCLUDED.value, unit = EXCLUDED.unit, computed_at = NOW()
  `);
  written['operations.sla_breaches'] = rowCount(breaches);

  return {
    written,
    facts: Object.values(written).reduce((total, n) => total + n, 0),
    fixesResolved,
    skipped,
  };
}
