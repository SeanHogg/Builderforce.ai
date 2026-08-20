/**
 * The WRITER for `finance.*` metric facts.
 *
 * Migrated onto {@link ../metricRollup} unchanged in behaviour: the SQL is the SQL
 * that closed the original defect — `burnRateService` reading `finance.burn`,
 * `DOMAIN_MANIFEST` declaring it, `founderCanvasPrompt` teaching the model to bind
 * a `liveMetric` to `finance.runway_months`, and nothing anywhere inserting one.
 *
 * ── WHAT IT COMPUTES, AND FROM WHAT ─────────────────────────────────────────
 *   • `expenses`         — approved/paid spend, by month → `finance.burn`
 *   • `ledger_entries`   — money in → `finance.revenue`; the cash position →
 *                          `finance.cash`
 *   • `invoice_line_items` × `ledger_entries` — the recurring part → `finance.mrr`
 *   • cash ÷ net burn    → `finance.runway_months`
 *
 * ── THE ONE ARITHMETIC ERROR THAT WOULD MATTER MOST ─────────────────────────
 * Runway is cash ÷ NET burn. A company with $100k of monthly costs and $80k of
 * monthly revenue is burning $20k, and reporting its runway off the $100k
 * understates it fivefold — the single most consequential mistake this file could
 * make, because a founder acts on it. It is written ONLY where both inputs exist
 * AND net burn is positive: a profitable tenant has no runway in months, and a
 * fabricated 9999 reads as "healthy" while a fabricated 0 fires every alarm on
 * the board.
 *
 * ── `finance.cash` AND `finance.revenue` ARE WRITTEN, NOT DECLARED ──────────
 * Neither is in `DOMAIN_MANIFEST.finance.metrics` — the seat charts burn, MRR and
 * runway — but both are real inputs the runway aggregate reads back out of
 * `metric_facts`, and publishing them is what makes a runway figure checkable
 * against the two numbers that produced it. The rollup contract test knows the
 * difference: a manifest key with no writer is a defect, an intermediate that no
 * seat charts is a working note.
 */

import { sql } from 'drizzle-orm';
import { fact, type DomainRollup } from '../metricRollup';

/** How many months of history each pass recomputes. */
const WINDOW_MONTHS = 18;

/**
 * A recent month's spend is still moving — an expense approved on the 3rd belongs
 * to last month — so the burn used for runway is a TRAILING THREE-MONTH AVERAGE
 * rather than the newest bucket. A single month is noisy enough that runway would
 * swing by 40% on an annual insurance payment, and a runway that moves like that
 * is one nobody trusts.
 */
const BURN_AVERAGE_MONTHS = 3;

const sinceMonth = sql`DATE_TRUNC('month', NOW()) - (${WINDOW_MONTHS} * INTERVAL '1 month')`;

/** `status IN ('approved','paid')` and not every row: a draft expense is a claim
 *  somebody typed, and counting it as burn would let anyone move the company's
 *  runway by filing an expense nobody approved. */
const burnTail = sql`
    FROM expenses e
   WHERE e.tenant_id IS NOT NULL
     AND e.status IN ('approved', 'paid')
     AND e.incurred_at >= ${sinceMonth}
`;

export const FINANCE_ROLLUP: DomainRollup = {
  domain: 'finance',
  metrics: [
    {
      key: 'finance.burn',
      requires: ['expenses'],
      build: () => [
        fact({
          metric: 'finance.burn',
          bucket: 'month',
          unit: 'USD',
          tenant: sql`e.tenant_id`,
          bucketAt: sql`DATE_TRUNC('month', e.incurred_at)`,
          value: sql`SUM(e.amount)`,
          tail: sql`${burnTail} GROUP BY e.tenant_id, DATE_TRUNC('month', e.incurred_at)`,
        }),
        // Burn by category, as a dimensioned slice of the same metric — what lets
        // "why did burn move?" be answerable from the series the tile already reads.
        fact({
          metric: 'finance.burn',
          bucket: 'month',
          unit: 'USD',
          tenant: sql`e.tenant_id`,
          bucketAt: sql`DATE_TRUNC('month', e.incurred_at)`,
          value: sql`SUM(e.amount)`,
          dimension: sql`JSONB_BUILD_OBJECT('category', e.category)`,
          dimensionKey: sql`'category:' || e.category`,
          tail: sql`${burnTail} GROUP BY e.tenant_id, e.category, DATE_TRUNC('month', e.incurred_at)`,
        }),
      ],
    },
    {
      key: 'finance.revenue',
      requires: ['ledger_entries'],
      // `invoice_line_items` carries no date of its own, so revenue is recognised
      // on the LEDGER entry that settled it: money recognised when it moved is
      // defensible, money recognised when a line was typed is not.
      build: () => fact({
        metric: 'finance.revenue',
        bucket: 'month',
        unit: 'USD',
        tenant: sql`l.tenant_id`,
        bucketAt: sql`DATE_TRUNC('month', l.occurred_at)`,
        value: sql`SUM(l.amount) / 100.0`,
        tail: sql`
            FROM ledger_entries l
           WHERE l.tenant_id IS NOT NULL
             AND l.denomination = 'usd_cents'
             AND l.entry_kind IN ('grant', 'commission')
             AND l.amount > 0
             AND l.occurred_at >= ${sinceMonth}
           GROUP BY l.tenant_id, DATE_TRUNC('month', l.occurred_at)
        `,
      }),
    },
    {
      key: 'finance.cash',
      requires: ['ledger_entries'],
      // The running balance at the end of each month. A single current balance
      // would be cheaper, but the SERIES is what makes runway checkable a month
      // later — a single point cannot be reconciled against anything.
      build: () => fact({
        metric: 'finance.cash',
        bucket: 'month',
        unit: 'USD',
        tenant: sql`months.tenant_id`,
        bucketAt: sql`months.bucket_at`,
        value: sql`SUM(SUM(months.amount)) OVER (PARTITION BY months.tenant_id ORDER BY months.bucket_at) / 100.0`,
        tail: sql`
            FROM (
              SELECT l.tenant_id, DATE_TRUNC('month', l.occurred_at) AS bucket_at, l.amount
                FROM ledger_entries l
               WHERE l.tenant_id IS NOT NULL AND l.denomination = 'usd_cents'
            ) AS months
           GROUP BY months.tenant_id, months.bucket_at
        `,
      }),
    },
    {
      key: 'finance.mrr',
      requires: ['invoice_line_items', 'ledger_entries'],
      // Recurring is a PROPERTY of the line, not of the month, so it reads
      // `source_kind = 'plan'` — a usage overage and a services invoice are
      // revenue and are emphatically not MRR, and a board that conflates them
      // reports a growth rate that reverses the following month.
      build: () => fact({
        metric: 'finance.mrr',
        bucket: 'month',
        unit: 'USD',
        tenant: sql`li.tenant_id`,
        bucketAt: sql`DATE_TRUNC('month', l.occurred_at)`,
        value: sql`SUM(li.amount)`,
        tail: sql`
            FROM invoice_line_items li
            JOIN ledger_entries l
              ON l.tenant_id = li.tenant_id AND l.reference = li.invoice_ref
           WHERE li.tenant_id IS NOT NULL
             AND li.source_kind = 'plan'
             AND l.occurred_at >= ${sinceMonth}
           GROUP BY li.tenant_id, DATE_TRUNC('month', l.occurred_at)
        `,
      }),
    },
    {
      key: 'finance.runway_months',
      // Reads the facts the three metrics above just wrote, so it depends on the
      // table it writes into rather than on any source table.
      requires: ['metric_facts'],
      build: () => fact({
        metric: 'finance.runway_months',
        bucket: 'month',
        unit: 'months',
        tenant: sql`a.tenant_id`,
        bucketAt: sql`DATE_TRUNC('month', NOW())`,
        value: sql`LEAST(a.cash / (a.burn - COALESCE(a.revenue, 0)), 999)`,
        tail: sql`
            FROM (
              SELECT tenant_id,
                     AVG(value) FILTER (WHERE metric = 'finance.burn'    AND recency <= ${BURN_AVERAGE_MONTHS}) AS burn,
                     AVG(value) FILTER (WHERE metric = 'finance.revenue' AND recency <= ${BURN_AVERAGE_MONTHS}) AS revenue,
                     MAX(value) FILTER (WHERE metric = 'finance.cash'    AND recency = 1)                       AS cash
                FROM (
                  SELECT tenant_id, metric, value, bucket_at,
                         ROW_NUMBER() OVER (PARTITION BY tenant_id, metric ORDER BY bucket_at DESC) AS recency
                    FROM metric_facts
                   WHERE metric IN ('finance.burn', 'finance.revenue', 'finance.cash')
                     AND bucket = 'month'
                     AND dimension_key = ''
                ) AS recent
               GROUP BY tenant_id
            ) AS a
           WHERE a.cash IS NOT NULL
             AND a.burn IS NOT NULL
             AND (a.burn - COALESCE(a.revenue, 0)) > 0
             AND a.cash > 0
        `,
      }),
    },
    {
      key: 'finance.monthly_burn',
      requires: ['metric_facts'],
      // The net monthly burn the runway was divided by, published so the two
      // numbers on a board cannot disagree about which burn produced which runway.
      build: () => fact({
        metric: 'finance.monthly_burn',
        bucket: 'month',
        unit: 'USD',
        tenant: sql`r.tenant_id`,
        bucketAt: sql`DATE_TRUNC('month', NOW())`,
        value: sql`AVG(r.value) FILTER (WHERE r.metric = 'finance.burn'    AND r.recency <= ${BURN_AVERAGE_MONTHS})
             - COALESCE(AVG(r.value) FILTER (WHERE r.metric = 'finance.revenue' AND r.recency <= ${BURN_AVERAGE_MONTHS}), 0)`,
        tail: sql`
            FROM (
              SELECT tenant_id, metric, value,
                     ROW_NUMBER() OVER (PARTITION BY tenant_id, metric ORDER BY bucket_at DESC) AS recency
                FROM metric_facts
               WHERE metric IN ('finance.burn', 'finance.revenue')
                 AND bucket = 'month'
                 AND dimension_key = ''
            ) AS r
           GROUP BY r.tenant_id
          HAVING AVG(r.value) FILTER (WHERE r.metric = 'finance.burn' AND r.recency <= ${BURN_AVERAGE_MONTHS}) IS NOT NULL
        `,
      }),
    },
  ],
};
