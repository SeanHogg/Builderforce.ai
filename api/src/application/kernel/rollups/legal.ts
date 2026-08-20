/**
 * The WRITER for `legal.*` metric facts.
 *
 * Migrated onto {@link ../metricRollup} unchanged in behaviour — same predicates,
 * same buckets, same refusal to zero-fill.
 *
 *   • `legal.open_matters`  — matters not yet closed, daily. What counsel opens
 *     the morning on.
 *   • `legal.renewals_due`  — entity standings, jurisdiction registrations and IP
 *     rights whose renewal falls inside the next ninety days, daily. The single
 *     most valuable number a legal register produces, because every one of these
 *     lapses QUIETLY and the first symptom is a penalty.
 *
 * ── ONE METRIC OVER THREE TABLES ─────────────────────────────────────────────
 * `renewals_due` is a UNION across entities, registrations and IP rather than
 * three metrics, and the reason is the question: nobody asks "how many trademark
 * renewals" — they ask "what lapses this quarter". Three keys would make the
 * answer a sum somebody has to remember to compute, and the per-kind breakdown is
 * a DIMENSION of the same metric.
 */

import { sql } from 'drizzle-orm';
import { fact, type DomainRollup, type PresentTables } from '../metricRollup';

/** How far ahead a renewal counts as "due". A quarter is the shortest window in
 *  which a lapsed registration can still be fixed without a penalty in most
 *  jurisdictions — a 30-day warning is a notification, not a chance to act. */
const RENEWAL_HORIZON_DAYS = 90;

/** How many days of open-matter history each pass recomputes. */
const WINDOW_DAYS = 90;

/** Terminal matter states. A settled or closed matter is not open, and counting
 *  one is how a cleared desk looks like a busy one. */
const CLOSED = sql.join(['settled', 'closed'].map((s) => sql`${s}`), sql`, `);

/** The three registers a renewal can live in. */
const REGISTERS: ReadonlyArray<{ table: string; kind: string }> = [
  { table: 'legal_entities', kind: 'entity' },
  { table: 'legal_registrations', kind: 'registration' },
  { table: 'intellectual_property', kind: 'ip' },
];

function renewalRows(present: PresentTables) {
  const parts = REGISTERS.filter((r) => present.has(r.table)).map((register) => sql`
    SELECT tenant_id, ${register.kind} AS kind
      FROM ${sql.raw(register.table)}
     WHERE tenant_id IS NOT NULL
       AND renews_at IS NOT NULL
       AND renews_at <= (CURRENT_DATE + (${RENEWAL_HORIZON_DAYS} * INTERVAL '1 day'))
  `);
  return parts.length ? sql.join(parts, sql` UNION ALL `) : null;
}

export const LEGAL_ROLLUP: DomainRollup = {
  domain: 'legal',
  metrics: [
    {
      key: 'legal.open_matters',
      requires: ['legal_matters'],
      // Bucketed on the day the matter was OPENED rather than on today, so the
      // series is a recomputable history — the same argument `finance.cash`
      // makes for a running balance.
      build: () => fact({
        metric: 'legal.open_matters',
        bucket: 'day',
        unit: 'matters',
        tenant: sql`m.tenant_id`,
        bucketAt: sql`DATE_TRUNC('day', COALESCE(m.opened_at::timestamp, m.created_at))`,
        value: sql`COUNT(*)`,
        tail: sql`
            FROM legal_matters m
           WHERE m.tenant_id IS NOT NULL
             AND m.status NOT IN (${CLOSED})
             AND COALESCE(m.opened_at::timestamp, m.created_at) >= DATE_TRUNC('day', NOW()) - (${WINDOW_DAYS} * INTERVAL '1 day')
           GROUP BY m.tenant_id, DATE_TRUNC('day', COALESCE(m.opened_at::timestamp, m.created_at))
        `,
      }),
    },
    {
      key: 'legal.renewals_due',
      requires: [],
      build: (present) => {
        const rows = renewalRows(present);
        if (!rows) return null;
        // Bucketed on TODAY, deliberately and unlike the metric above: "what is
        // due in the next ninety days" is a statement about now, and back-dating
        // it onto the renewal's own date would produce a series that says a
        // renewal was due on a day nobody could have acted.
        return [
          fact({
            metric: 'legal.renewals_due',
            bucket: 'day',
            unit: 'renewals',
            tenant: sql`r.tenant_id`,
            bucketAt: sql`DATE_TRUNC('day', NOW())`,
            value: sql`COUNT(*)`,
            tail: sql`FROM (${rows}) AS r GROUP BY r.tenant_id`,
          }),
          fact({
            metric: 'legal.renewals_due',
            bucket: 'day',
            unit: 'renewals',
            tenant: sql`r.tenant_id`,
            bucketAt: sql`DATE_TRUNC('day', NOW())`,
            value: sql`COUNT(*)`,
            dimension: sql`JSONB_BUILD_OBJECT('register', r.kind)`,
            dimensionKey: sql`'register:' || r.kind`,
            tail: sql`FROM (${rows}) AS r GROUP BY r.tenant_id, r.kind`,
          }),
        ];
      },
    },
  ],
};
