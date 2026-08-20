/**
 * The WRITER for `operations.*` metric facts — and for the one derived column the
 * operations schema declares.
 *
 * Migrated onto {@link ../metricRollup} unchanged in behaviour: the SQL below is
 * the SQL that shipped with the sixteenth seat, with the `INSERT … ON CONFLICT`
 * envelope, the `tableExists` probe and the result shape lifted into the engine
 * every domain now shares. Nothing about what these numbers mean changed.
 *
 * ── THE THREE NUMBERS ────────────────────────────────────────────────────────
 *   • `operations.open_work_orders` — the backlog, daily. The number a service
 *     business opens its morning on.
 *   • `operations.first_time_fix`   — the share of completed jobs fixed on ONE
 *     visit, monthly. The headline operational metric of every vertical this
 *     domain serves: a second visit is a doubled cost against a single invoice.
 *   • `operations.sla_breaches`     — jobs that missed their contracted date.
 *
 * ── AND WHY IT WRITES A COLUMN, NOT ONLY FACTS ───────────────────────────────
 * `work_orders.first_time_fix` is EVIDENCE, not an opinion, and its value is a
 * property of the visits underneath it: one attendance that resolved the job, or
 * more than one. The generic entity writer can set any writable column, so a
 * client CAN assert it — which is exactly why `prepare` recomputes it from
 * `work_order_visits` before the metric that reads it runs. An asserted value is
 * corrected rather than trusted.
 */

import { sql } from 'drizzle-orm';
import type { Db } from '../../../infrastructure/database/connection';
import { fact, type DomainRollup, type PresentTables } from '../metricRollup';

/** How many months of first-time-fix history each pass recomputes. */
const WINDOW_MONTHS = 18;
/** How many days of backlog/breach history each pass recomputes. */
const WINDOW_DAYS = 90;

/** Terminal states. An order that was cancelled is not backlog and is not a breach:
 *  counting it as either is how a cleaned-up queue looks like a failing one. */
const CLOSED = sql.join(['completed', 'cancelled'].map((s) => sql`${s}`), sql`, `);

const openTail = sql`
    FROM work_orders o
   WHERE o.tenant_id IS NOT NULL
     AND o.status NOT IN (${CLOSED})
     AND o.created_at >= DATE_TRUNC('day', NOW()) - (${WINDOW_DAYS} * INTERVAL '1 day')
`;

export const OPERATIONS_ROLLUP: DomainRollup = {
  domain: 'operations',

  /**
   * The derived column, before the metric that reads it.
   *
   * First-time fix = the job is completed AND exactly one visit actually reached
   * the site. `check_in_at IS NOT NULL` rather than a count of visit ROWS is the
   * whole subtlety: a visit that was booked and cancelled, or one where nobody
   * could get in, did not consume a second attendance and must not count against
   * the engineer who fixed it on their only trip. An order with NO recorded
   * attendance stays NULL — unknowable is not the same as false.
   */
  prepare: async (db: Db, present: PresentTables): Promise<Record<string, number>> => {
    if (!present.has('work_orders') || !present.has('work_order_visits')) return {};
    const resolved = await db.execute(sql`
      UPDATE work_orders o
         -- Parenthesised deliberately: SET col = a = b is legal and reads as an
         -- assignment of a comparison, which is a sentence no reviewer should have
         -- to parse twice. updated_at is NOT touched — recomputing evidence must
         -- not reorder the seat's "recently touched" list under somebody's cursor.
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
    return { fixesResolved: Number((resolved as { rowCount?: number }).rowCount ?? 0) };
  },

  metrics: [
    {
      key: 'operations.open_work_orders',
      requires: ['work_orders'],
      build: () => [
        // Bucketed on the day the order was RAISED rather than on today, so the
        // series is a recomputable history: a single "open right now" counter
        // cannot be reconciled a week later, which is the argument
        // `finance.cash` already makes for a running balance.
        fact({
          metric: 'operations.open_work_orders',
          bucket: 'day',
          unit: 'orders',
          tenant: sql`o.tenant_id`,
          bucketAt: sql`DATE_TRUNC('day', o.created_at)`,
          value: sql`COUNT(*)`,
          tail: sql`${openTail} GROUP BY o.tenant_id, DATE_TRUNC('day', o.created_at)`,
        }),
        // Sliced by discipline as a DIMENSION of the same metric rather than a
        // second metric — what makes "which trade is drowning?" answerable from
        // the series the tile already reads.
        fact({
          metric: 'operations.open_work_orders',
          bucket: 'day',
          unit: 'orders',
          tenant: sql`o.tenant_id`,
          bucketAt: sql`DATE_TRUNC('day', o.created_at)`,
          value: sql`COUNT(*)`,
          dimension: sql`JSONB_BUILD_OBJECT('discipline', o.discipline)`,
          dimensionKey: sql`'discipline:' || o.discipline`,
          tail: sql`${openTail} GROUP BY o.tenant_id, o.discipline, DATE_TRUNC('day', o.created_at)`,
        }),
      ],
    },
    {
      key: 'operations.first_time_fix',
      requires: ['work_orders'],
      // Monthly rather than daily because the denominator matters: at a daily
      // grain a two-job Tuesday reads as 50% or 100% and the line is noise. Only
      // orders whose first_time_fix is KNOWN are counted — an unattended job is
      // absent from both halves rather than dragging the rate down.
      build: () => fact({
        metric: 'operations.first_time_fix',
        bucket: 'month',
        unit: 'percent',
        tenant: sql`o.tenant_id`,
        bucketAt: sql`DATE_TRUNC('month', o.completed_at)`,
        value: sql`ROUND(100.0 * COUNT(*) FILTER (WHERE o.first_time_fix) / COUNT(*), 2)`,
        tail: sql`
            FROM work_orders o
           WHERE o.tenant_id IS NOT NULL
             AND o.completed_at IS NOT NULL
             AND o.first_time_fix IS NOT NULL
             AND o.completed_at >= DATE_TRUNC('month', NOW()) - (${WINDOW_MONTHS} * INTERVAL '1 month')
           GROUP BY o.tenant_id, DATE_TRUNC('month', o.completed_at)
        `,
      }),
    },
    {
      key: 'operations.sla_breaches',
      requires: ['work_orders'],
      // Two ways to breach and they are ONE fact: finished late, or still open
      // past the date. Counting only the first understates the number precisely
      // when it matters most — during the outage that is currently running — so
      // an open, overdue job is a breach the day it becomes one, bucketed on the
      // date it was DUE.
      build: () => fact({
        metric: 'operations.sla_breaches',
        bucket: 'day',
        unit: 'orders',
        tenant: sql`o.tenant_id`,
        bucketAt: sql`DATE_TRUNC('day', o.sla_due_at)`,
        value: sql`COUNT(*)`,
        tail: sql`
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
        `,
      }),
    },
  ],
};
