/**
 * The WRITER for the `revenue.*` SaaS-economics facts: MRR and its month-over-month
 * movement, per tenant.
 *
 * ── WHAT IT COMPUTES, AND FROM WHAT ─────────────────────────────────────────
 * The same recurring source `finance.mrr` reads — `invoice_line_items` with
 * `source_kind = 'plan'`, recognised on the `ledger_entries` row that settled the
 * invoice — but kept PER CUSTOMER, because a movement between two months is a
 * statement about one customer: the sum going up says nothing about whether it
 * went up because somebody joined or because somebody left and somebody else
 * expanded.
 *
 * The customer is `invoices.customer_ref` (the `party_roles.party_ref` binding),
 * falling back to `customer_name` for an invoice issued without a bound party, so a
 * customer is never silently dropped from the roll-forward.
 *
 * Per customer and month, against the previous month:
 *   • prev = 0, cur > 0  → newMrr          (reactivation counts as new: the month before it was zero)
 *   • prev > 0, cur > prev → expansionMrr  (cur − prev)
 *   • prev > 0, 0 < cur < prev → contractionMrr (prev − cur)
 *   • prev > 0, cur = 0  → churnedMrr      (prev), and one customer lost
 * `revenue.mrr` is the sum of `cur` and `revenue.customers` the count with cur > 0.
 *
 * ── WHY THE MONTH AFTER THE LAST ONE IS INCLUDED ────────────────────────────
 * A customer who churned has NO row in the month they churned, so a roll-forward
 * built only from months that have rows would never see the loss. The month grid
 * is therefore each customer's observed months plus the month after each, which
 * gives the churn month a `cur = 0` row to be measured against. The month after
 * the current one is excluded: it has not happened.
 *
 * ── THE HONESTY RULE ────────────────────────────────────────────────────────
 * Facts are written only where rows exist behind them (no zero-fill for a tenant
 * with no plan lines). The first month of a customer's history is the first month
 * of the window; nothing earlier is invented, so a window-start month reports
 * everyone as new and consumers should read the latest complete month, which the
 * growth metrics do.
 */

import { sql } from 'drizzle-orm';
import { fact, type DomainRollup, type FactSpec } from '../metricRollup';

/** How many months of history each pass recomputes. */
const WINDOW_MONTHS = 18;

const sinceMonth = sql`DATE_TRUNC('month', NOW()) - (${WINDOW_MONTHS} * INTERVAL '1 month')`;

/**
 * (tenant, customer, month, mrr) for every month a customer was billed a plan line.
 *
 * Joined to `invoices` on the natural key the lines point at, restricted to
 * `document_kind = 'invoice'` so a vendor bill that shares a reference cannot be
 * mistaken for revenue.
 */
const customerMonths = sql`
    SELECT li.tenant_id                                          AS tenant_id,
           COALESCE(inv.customer_ref, inv.customer_name)          AS customer,
           DATE_TRUNC('month', l.occurred_at)                     AS at,
           SUM(li.amount)                                         AS mrr
      FROM invoice_line_items li
      JOIN invoices inv
        ON inv.tenant_id = li.tenant_id AND inv.reference = li.invoice_ref
      JOIN ledger_entries l
        ON l.tenant_id = li.tenant_id AND l.reference = li.invoice_ref
     WHERE li.tenant_id IS NOT NULL
       AND li.document_kind = 'invoice'
       AND li.source_kind = 'plan'
       AND COALESCE(inv.customer_ref, inv.customer_name) IS NOT NULL
       AND l.occurred_at >= ${sinceMonth}
     GROUP BY li.tenant_id, COALESCE(inv.customer_ref, inv.customer_name), DATE_TRUNC('month', l.occurred_at)
`;

/**
 * Each customer's MRR for a month and the month before, over the grid described in
 * the header (observed months plus the following month).
 */
const movements = sql`
    SELECT g.tenant_id AS tenant_id,
           g.at        AS at,
           COALESCE(cur.mrr, 0)  AS cur,
           COALESCE(prev.mrr, 0) AS prev
      FROM (
        SELECT DISTINCT tenant_id, customer, at FROM (
          SELECT tenant_id, customer, at FROM (${customerMonths}) cm
           UNION ALL
          SELECT tenant_id, customer, (at + INTERVAL '1 month') AS at FROM (${customerMonths}) cm2
        ) u
         WHERE u.at <= DATE_TRUNC('month', NOW())
      ) g
      LEFT JOIN (${customerMonths}) cur
        ON cur.tenant_id = g.tenant_id AND cur.customer = g.customer AND cur.at = g.at
      LEFT JOIN (${customerMonths}) prev
        ON prev.tenant_id = g.tenant_id AND prev.customer = g.customer
       AND prev.at = g.at - INTERVAL '1 month'
`;

const movementTail = (where: ReturnType<typeof sql>, value: ReturnType<typeof sql>): Pick<FactSpec, 'value' | 'tail'> => ({
  value,
  tail: sql`
      FROM (${movements}) m
     WHERE ${where}
     GROUP BY m.tenant_id, m.at
  `,
});

const monthlyFact = (metric: string, unit: string, spec: Pick<FactSpec, 'value' | 'tail'>): ReturnType<typeof fact> =>
  fact({
    metric,
    bucket: 'month',
    unit,
    tenant: sql`m.tenant_id`,
    bucketAt: sql`m.at`,
    ...spec,
  });

const REQUIRES = ['invoice_line_items', 'invoices', 'ledger_entries'] as const;

/**
 * The metric specs, exported as a list rather than as a second `DomainRollup`: the
 * registry holds ONE rollup per domain (`ROLLUP_BY_DOMAIN`, and the contract test
 * that asserts `METRIC_ROLLUPS.length === DOMAINS.length`), and `revenue` already has
 * `REVENUE_ROLLUP` for the deal metrics. `rollups/revenue.ts` spreads these in.
 */
export const REVENUE_ECONOMICS_METRICS: DomainRollup['metrics'] = [
    {
      key: 'revenue.mrr',
      requires: REQUIRES,
      build: () => monthlyFact('revenue.mrr', 'USD', movementTail(sql`m.cur > 0`, sql`SUM(m.cur)`)),
    },
    {
      key: 'revenue.newMrr',
      requires: REQUIRES,
      build: () => monthlyFact('revenue.newMrr', 'USD', movementTail(sql`m.prev = 0 AND m.cur > 0`, sql`SUM(m.cur)`)),
    },
    {
      key: 'revenue.expansionMrr',
      requires: REQUIRES,
      build: () => monthlyFact('revenue.expansionMrr', 'USD', movementTail(sql`m.prev > 0 AND m.cur > m.prev`, sql`SUM(m.cur - m.prev)`)),
    },
    {
      key: 'revenue.contractionMrr',
      requires: REQUIRES,
      build: () => monthlyFact('revenue.contractionMrr', 'USD', movementTail(sql`m.prev > 0 AND m.cur > 0 AND m.cur < m.prev`, sql`SUM(m.prev - m.cur)`)),
    },
    {
      key: 'revenue.churnedMrr',
      requires: REQUIRES,
      build: () => monthlyFact('revenue.churnedMrr', 'USD', movementTail(sql`m.prev > 0 AND m.cur = 0`, sql`SUM(m.prev)`)),
    },
    {
      key: 'revenue.customers',
      requires: REQUIRES,
      build: () => monthlyFact('revenue.customers', 'count', movementTail(sql`m.cur > 0`, sql`COUNT(*)`)),
    },
    {
      key: 'revenue.customersLost',
      requires: REQUIRES,
      build: () => monthlyFact('revenue.customersLost', 'count', movementTail(sql`m.prev > 0 AND m.cur = 0`, sql`COUNT(*)`)),
    },
];

/** The same specs as a standalone rollup, for tests and a targeted re-run. */
export const REVENUE_ECONOMICS_ROLLUP: DomainRollup = {
  domain: 'revenue',
  metrics: REVENUE_ECONOMICS_METRICS,
};
