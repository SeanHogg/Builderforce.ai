/**
 * The WRITER for `finance.*` metric facts.
 *
 * Migrated onto {@link ../metricRollup} unchanged in behaviour: the SQL is the SQL
 * that closed the original defect — `burnRateService` reading `finance.burn`,
 * `DOMAIN_MANIFEST` declaring it, `founderCanvasPrompt` teaching the model to bind
 * a `liveMetric` to `finance.runway_months`, and nothing anywhere inserting one.
 *
 * ── WHAT IT COMPUTES, AND FROM WHAT ─────────────────────────────────────────
 *   • `expenses` + `pay_runs` — approved/paid spend AND processed payroll, by
 *                          month → `finance.burn`
 *   • `ledger_entries`   — money in → `finance.revenue`; the cash position →
 *                          `finance.cash`
 *   • `invoice_line_items` × `ledger_entries` — the recurring part → `finance.mrr`
 *   • cash ÷ net burn    → `finance.runway_months`
 *
 * ── WHY PAYROLL IS IN THE SAME METRIC AND NOT BESIDE IT ─────────────────────
 * Because the largest line in almost every company's burn is people, and until
 * migration 0926 there was nowhere for it: `expenses` holds reimbursement CLAIMS,
 * not what a payroll provider actually paid, so a workspace running payroll
 * through Gusto had a burn figure missing its biggest component and a runway
 * computed off it. `pay_runs` is money that left, read back from the provider that
 * moved it — see `application/finance/payRuns.ts` for why this platform never
 * calculates it.
 *
 * The two sources are UNIONED inside one statement rather than written as two
 * facts, and that is load-bearing: `metric_facts` is keyed on
 * `(tenant, metric, bucket, bucket_at, dimension_key)`, so a second undimensioned
 * writer for `finance.burn` would not add to the total — it would REPLACE it,
 * which is the exact failure `fact()` throws to prevent for attributed rows.
 *
 * The category slice unions them too, with pay runs contributing a fixed
 * `Payroll`. A tenant who has ALSO categorised an expense `Payroll` sums into the
 * same bar, which is right rather than a collision: both are money spent paying
 * people, and two bars with one label would be the confusing outcome.
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

/**
 * A row the LEDGER PORT synced, rather than one a person typed.
 *
 * `account_kind = 'external'` is a value no other writer on this platform produces —
 * every existing reader of `ledger_entries` filters on 'tenant' | 'user' | 'partner'
 * | 'seller' | 'agent' — so provenance is structural here rather than a flag
 * somebody has to remember to set. See `application/finance/ledgerSync.ts`.
 *
 * `txStatus = 'posted'` is not a nicety. A pending card hold can still vanish, and
 * the port's own `foldTransactionsToMonths` drops it for exactly that reason; a
 * runway that moved on money which never left is the failure this whole seam exists
 * to prevent. `usd_cents` is the same honesty applied to currency: a euro row is
 * stored faithfully and simply not summed into a dollar total, because the
 * alternative is an FX rate baked into an aggregate.
 */
const syncedRow = (alias: string) => sql.raw(
  `${alias}.account_kind = 'external' AND ${alias}.denomination = 'usd_cents' `
  + `AND ${alias}.metadata->>'txStatus' = 'posted'`,
);

/**
 * "Is this tenant-month already accounted for by a connected book?"
 *
 * ── THE DEFECT THIS PREVENTS, WHICH IS THE WORST ONE AVAILABLE ─────────────────
 * A founder types their expenses for six months, then connects QuickBooks.
 * QuickBooks reports the same money. Without this predicate both arms of the union
 * count it and the burn DOUBLES — and a doubled burn halves the runway, which is
 * the single number a founder acts on. It is worse than a missing feature because
 * it looks like a working one.
 *
 * So a month a book covers supersedes the typed rows for that month. That is a
 * defensible rule rather than a convenient one: the book is what actually left the
 * account, and a typed claim for the same month is either the same money or a claim
 * that was never paid.
 *
 * `ledgerCoverage = 'full'` and not merely "synced": only a bank feed or a complete
 * accounting ledger sees everything that leaves. Stripe sees what came through
 * Stripe, so a Stripe-covered month must NOT suppress hand-typed rent — that would
 * make the burn collapse instead of double, which is the same defect pointing the
 * other way. The flag is declared on the provider (`coversAllSpend`) and stamped by
 * the sync.
 */
const monthCoveredByBook = (tenantColumn: string, monthExpression: string) => sql.raw(
  `EXISTS (SELECT 1 FROM ledger_entries cov`
  + ` WHERE cov.tenant_id = ${tenantColumn}`
  + `   AND cov.account_kind = 'external'`
  + `   AND cov.denomination = 'usd_cents'`
  + `   AND cov.metadata->>'txStatus' = 'posted'`
  + `   AND cov.metadata->>'ledgerCoverage' = 'full'`
  + `   AND DATE_TRUNC('month', cov.occurred_at) = ${monthExpression})`,
);

/**
 * Every row of real spend, from both sources, as (tenant, month, amount).
 *
 * `status IN ('approved','paid')` on the expense side and not every row: a draft
 * expense is a claim somebody typed, and counting it as burn would let anyone move
 * the company's runway by filing an expense nobody approved. `status = 'processed'`
 * on the payroll side is the same rule — an OPEN pay run is money that has not
 * left yet.
 *
 * Payroll buckets on `paid_at` and not on the pay PERIOD, because a period
 * straddling a month boundary would otherwise land its whole cost in the wrong
 * month — the reasoning the `pay_runs` schema states for the column.
 */
const spendRows = sql`
    SELECT e.tenant_id                                AS tenant_id,
           DATE_TRUNC('month', e.incurred_at)         AS at,
           e.amount                                   AS amount,
           COALESCE(e.category, 'Uncategorised')      AS category
      FROM expenses e
     WHERE e.tenant_id IS NOT NULL
       AND e.status IN ('approved', 'paid')
       AND e.incurred_at >= ${sinceMonth}
       AND NOT ${monthCoveredByBook('e.tenant_id', "DATE_TRUNC('month', e.incurred_at)")}
     UNION ALL
    SELECT p.tenant_id                                AS tenant_id,
           DATE_TRUNC('month', p.paid_at)             AS at,
           p.total_cost                               AS amount,
           'Payroll'                                  AS category
      FROM pay_runs p
     WHERE p.status = 'processed'
       AND p.paid_at IS NOT NULL
       AND p.paid_at >= ${sinceMonth}
       AND NOT ${monthCoveredByBook('p.tenant_id', "DATE_TRUNC('month', p.paid_at)")}
     UNION ALL
    /*
     * The THIRD source, and the one that makes the number live: money that actually
     * left, read back out of the company's own books by the ledger port. Amounts are
     * signed cents from the company's point of view — negative is out — so the sign
     * is flipped and scaled here, and the WHERE clause takes only the outflows.
     *
     * The category comes from the provider's own chart of accounts, verbatim, so
     * "why did burn move?" is answerable from the same series the tile already reads
     * without anybody having to map a vendor's vocabulary onto ours.
     */
    SELECT l.tenant_id                                       AS tenant_id,
           DATE_TRUNC('month', l.occurred_at)                AS at,
           (-l.amount) / 100.0                               AS amount,
           COALESCE(l.metadata->>'category', 'Uncategorised') AS category
      FROM ledger_entries l
     WHERE l.tenant_id IS NOT NULL
       AND ${syncedRow('l')}
       AND l.amount < 0
       AND l.occurred_at >= ${sinceMonth}
`;

const burnTail = sql`FROM (${spendRows}) b`;

/**
 * "This tenant's books report a real balance, so do not derive one."
 *
 * Lives here rather than inline because it is the predicate that keeps the two
 * `finance.cash` writers over disjoint tenant sets — and two writers for one
 * undimensioned metric key OVERWRITE rather than add, which would make whichever
 * ran last the answer.
 */
const balanceReportingTenantExcluded = sql`
                   AND NOT EXISTS (
                         SELECT 1 FROM ledger_accounts la
                          WHERE la.tenant_id = l.tenant_id
                            AND la.account_kind IN ('bank', 'credit'))`;

export const FINANCE_ROLLUP: DomainRollup = {
  domain: 'finance',
  metrics: [
    {
      key: 'finance.burn',
      // All three, because the union names all three. None is optional on a
      // migrated database — `pay_runs` ships in 0926 and `ledger_entries` is the
      // kernel — and requiring only some would let the metric publish a total that
      // silently omits one of its sources, which for the synced arm would mean a
      // burn figure quietly reverting to what somebody typed.
      requires: ['expenses', 'pay_runs', 'ledger_entries'],
      build: () => [
        fact({
          metric: 'finance.burn',
          bucket: 'month',
          unit: 'USD',
          tenant: sql`b.tenant_id`,
          bucketAt: sql`b.at`,
          value: sql`SUM(b.amount)`,
          tail: sql`${burnTail} GROUP BY b.tenant_id, b.at`,
        }),
        // Burn by category, as a dimensioned slice of the same metric — what lets
        // "why did burn move?" be answerable from the series the tile already reads.
        fact({
          metric: 'finance.burn',
          bucket: 'month',
          unit: 'USD',
          tenant: sql`b.tenant_id`,
          bucketAt: sql`b.at`,
          value: sql`SUM(b.amount)`,
          dimension: sql`JSONB_BUILD_OBJECT('category', b.category)`,
          dimensionKey: sql`'category:' || b.category`,
          tail: sql`${burnTail} GROUP BY b.tenant_id, b.category, b.at`,
        }),
      ],
    },
    {
      key: 'finance.revenue',
      requires: ['ledger_entries'],
      // `invoice_line_items` carries no date of its own, so revenue is recognised
      // on the LEDGER entry that settled it: money recognised when it moved is
      // defensible, money recognised when a line was typed is not.
      //
      // TWO ARMS since the ledger port landed, and they are mutually exclusive by
      // month for the same reason burn's are: the platform-side `grant`/`commission`
      // entries and a connected book's inflows can be the same money seen twice, and
      // a doubled revenue figure understates net burn just as badly as a doubled
      // burn overstates it.
      build: () => fact({
        metric: 'finance.revenue',
        bucket: 'month',
        unit: 'USD',
        tenant: sql`r.tenant_id`,
        bucketAt: sql`r.at`,
        value: sql`SUM(r.amount)`,
        tail: sql`
            FROM (
              SELECT l.tenant_id                        AS tenant_id,
                     DATE_TRUNC('month', l.occurred_at) AS at,
                     l.amount / 100.0                   AS amount
                FROM ledger_entries l
               WHERE l.tenant_id IS NOT NULL
                 AND l.denomination = 'usd_cents'
                 AND l.entry_kind IN ('grant', 'commission')
                 AND l.amount > 0
                 AND l.occurred_at >= ${sinceMonth}
                 AND NOT ${monthCoveredByBook('l.tenant_id', "DATE_TRUNC('month', l.occurred_at)")}
               UNION ALL
              SELECT l.tenant_id                        AS tenant_id,
                     DATE_TRUNC('month', l.occurred_at) AS at,
                     l.amount / 100.0                   AS amount
                FROM ledger_entries l
               WHERE l.tenant_id IS NOT NULL
                 AND ${syncedRow('l')}
                 AND l.amount > 0
                 AND l.occurred_at >= ${sinceMonth}
            ) AS r
           GROUP BY r.tenant_id, r.at
        `,
      }),
    },
    {
      key: 'finance.cash',
      requires: ['ledger_entries'],
      // The running balance at the end of each month. A single current balance
      // would be cheaper, but the SERIES is what makes runway checkable a month
      // later — a single point cannot be reconciled against anything.
      //
      // ── WHY THIS METRIC HAS TWO WRITERS AND THEY CANNOT COLLIDE ─────────────
      // `metric_facts` is keyed on (tenant, metric, bucket, bucket_at,
      // dimension_key), so a second undimensioned writer for `finance.cash` would
      // REPLACE the first rather than add to it. These two are therefore written
      // over DISJOINT TENANT SETS, enforced in SQL rather than by ordering: the
      // derived arm excludes any tenant whose books report a real balance, and the
      // reported arm covers exactly those tenants.
      //
      // The reported one wins where it exists because it is a different QUALITY of
      // answer. Summing the movements we have seen gives the net flow since somebody
      // connected the account — for a company that connected last week, a cash
      // position of a few thousand dollars and a runway of days. The bank's own
      // number needs no opening balance because it IS the balance.
      build: (present) => {
        const reportsBalances = present.has('ledger_accounts');
        const derived = fact({
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
                 WHERE l.tenant_id IS NOT NULL
                   AND l.denomination = 'usd_cents'
                   AND l.account_kind <> 'external'
                   ${reportsBalances ? balanceReportingTenantExcluded : sql``}
              ) AS months
             GROUP BY months.tenant_id, months.bucket_at
          `,
        });
        if (!reportsBalances) return derived;
        return [
          derived,
          fact({
            metric: 'finance.cash',
            bucket: 'month',
            unit: 'USD',
            tenant: sql`la.tenant_id`,
            bucketAt: sql`DATE_TRUNC('month', NOW())`,
            // `bank` plus `credit`, and the adapters have already NEGATED every
            // credit balance — a card balance is money owed, not money held, and a
            // company with $50k in the bank and $10k on the card has $40k. `other`
            // is excluded because the port says only two kinds net into cash: a
            // suspense account summed in is money nobody can spend.
            value: sql`SUM(la.balance)`,
            tail: sql`
                FROM ledger_accounts la
               WHERE la.account_kind IN ('bank', 'credit')
                 AND la.currency = 'USD'
               GROUP BY la.tenant_id
            `,
          }),
        ];
      },
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
