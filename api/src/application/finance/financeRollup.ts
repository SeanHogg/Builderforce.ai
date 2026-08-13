/**
 * The WRITER for `finance.*` metric facts.
 *
 * ── THE DEFECT THIS CLOSES ───────────────────────────────────────────────────────
 * `burnRateService.ts` READS `finance.burn`, `finance.monthly_burn` and
 * `finance.runway_months` out of `metric_facts`. `DOMAIN_MANIFEST` declares those three
 * as the finance seat's charted metrics. `founderCanvasPrompt.ts` instructs the model, by
 * name, to bind a `liveMetric` to `finance.runway_months`, and `canvas_refresh_live_metric`
 * repeats the same key in its tool description.
 *
 * Nothing anywhere in `api/src` ever INSERTED one. A grep for an insert into
 * `metric_facts` found exactly two — `<domain>.items` and `<domain>.events` in
 * `registryProjection.ts` — and neither is a finance key.
 *
 * So the product documented a binding its own backend never populated: the flagship
 * "live, not stale" promise, on the one number every founder-facing surface leads with,
 * was an empty read dressed as a live one. `fetchBurnRate` returned `{available: false,
 * reason: 'no_data'}` for every tenant that ever existed, and the canvas rendered a
 * `liveMetric` bound to a key with no writer.
 *
 * ── WHAT IT COMPUTES, AND FROM WHAT ─────────────────────────────────────────────
 * From tables that already exist and are already written to:
 *   • `expenses`         — approved/paid spend, by month → `finance.burn`
 *   • `invoice_line_items` + `ledger_entries` — money in → `finance.revenue`, `finance.mrr`
 *   • `ledger_entries`   — the cash position → `finance.cash`
 *   • cash ÷ net burn    → `finance.runway_months`
 *
 * ── THE RULE THAT KEEPS THE NUMBER HONEST ───────────────────────────────────────
 * A metric is written ONLY when the rows behind it exist. There is no zero-fill, and
 * that is deliberate: a runway of 0 renders as "out of money", and writing one for a
 * tenant that simply has not connected its accounting would turn an absent number into
 * an alarming one — `trigger` objects would fire on it. An absent fact keeps
 * `fetchBurnRate`'s honest `no_data`, which the UI already knows how to render.
 *
 * ── COST ────────────────────────────────────────────────────────────────────────
 * One statement per metric, each a grouped aggregate over an indexed range, upserting on
 * the `uq_metric_facts_point` key — no per-tenant fan-out and no N+1, per the caching and
 * performance standard. The sweep is gated by `cronWorkSignal` upstream so an idle
 * workspace costs nothing ([[neon-cost-under-5-dollars]]).
 */

import { sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';

export interface FinanceRollupResult {
  /** metric key → rows upserted. */
  written: Record<string, number>;
  /** Total facts written, for the sweep's log line. */
  facts: number;
  /** Metrics skipped because their source table is absent in this environment. */
  skipped: string[];
}

/** How many months of history each pass recomputes. */
const WINDOW_MONTHS = 18;

/**
 * A recent month's spend is still moving — an expense approved on the 3rd belongs to
 * last month — so the burn used for runway is a TRAILING THREE-MONTH AVERAGE rather than
 * the newest bucket. A single month is noisy enough that runway would swing by 40% on an
 * annual insurance payment, and a runway that moves like that is one nobody trusts.
 */
const BURN_AVERAGE_MONTHS = 3;

async function tableExists(db: Db, table: string): Promise<boolean> {
  const result = await db.execute(sql`SELECT to_regclass(${`public.${table}`}) IS NOT NULL AS present`);
  const rows = (result as unknown as { rows?: Array<{ present?: boolean }> }).rows ?? [];
  return rows[0]?.present === true;
}

function rowCount(result: unknown): number {
  return Number((result as { rowCount?: number }).rowCount ?? 0);
}

/**
 * Recompute the finance series into `metric_facts`.
 *
 * Idempotent: every statement upserts on `(tenant_id, metric, bucket, bucket_at,
 * dimension_key)`, so running twice in a day is a no-op rather than a double count.
 */
export async function runFinanceRollup(db: Db): Promise<FinanceRollupResult> {
  const written: Record<string, number> = {};
  const skipped: string[] = [];

  // ── Burn: what actually left the building, by month ────────────────────────────
  //
  // `status IN ('approved','paid')` and not every row: a draft expense is a claim
  // somebody typed, and counting it as burn would let anyone move the company's runway
  // by filing an expense nobody approved.
  if (await tableExists(db, 'expenses')) {
    const burn = await db.execute(sql`
      INSERT INTO metric_facts (tenant_id, metric, bucket, bucket_at, dimension_key, value, unit, computed_at)
      SELECT e.tenant_id,
             'finance.burn',
             'month',
             DATE_TRUNC('month', e.incurred_at),
             '',
             SUM(e.amount),
             MIN(e.currency),
             NOW()
      FROM expenses e
      WHERE e.tenant_id IS NOT NULL
        AND e.status IN ('approved', 'paid')
        AND e.incurred_at >= DATE_TRUNC('month', NOW()) - (${WINDOW_MONTHS} * INTERVAL '1 month')
      GROUP BY e.tenant_id, DATE_TRUNC('month', e.incurred_at)
      ON CONFLICT (tenant_id, metric, bucket, bucket_at, dimension_key) DO UPDATE
        SET value = EXCLUDED.value, unit = EXCLUDED.unit, computed_at = NOW()
    `);
    written['finance.burn'] = rowCount(burn);

    // Burn by category, as a dimensioned slice of the same metric rather than a second
    // metric — which is what `dimension_key` is for, and what lets "why did burn move?"
    // be answerable from the series the tile already reads.
    const byCategory = await db.execute(sql`
      INSERT INTO metric_facts (tenant_id, metric, bucket, bucket_at, dimension, dimension_key, value, unit, computed_at)
      SELECT e.tenant_id,
             'finance.burn',
             'month',
             DATE_TRUNC('month', e.incurred_at),
             JSONB_BUILD_OBJECT('category', e.category),
             'category:' || e.category,
             SUM(e.amount),
             MIN(e.currency),
             NOW()
      FROM expenses e
      WHERE e.tenant_id IS NOT NULL
        AND e.status IN ('approved', 'paid')
        AND e.incurred_at >= DATE_TRUNC('month', NOW()) - (${WINDOW_MONTHS} * INTERVAL '1 month')
      GROUP BY e.tenant_id, e.category, DATE_TRUNC('month', e.incurred_at)
      ON CONFLICT (tenant_id, metric, bucket, bucket_at, dimension_key) DO UPDATE
        SET value = EXCLUDED.value, unit = EXCLUDED.unit, computed_at = NOW()
    `);
    written['finance.burn/category'] = rowCount(byCategory);
  } else {
    skipped.push('finance.burn (expenses absent)');
  }

  // ── Revenue and MRR ────────────────────────────────────────────────────────────
  //
  // `invoice_line_items` carries no date of its own, so revenue is recognised on the
  // LEDGER entry that settled it: money recognised when it moved is defensible, money
  // recognised when a line was typed is not.
  if (await tableExists(db, 'ledger_entries')) {
    const revenue = await db.execute(sql`
      INSERT INTO metric_facts (tenant_id, metric, bucket, bucket_at, dimension_key, value, unit, computed_at)
      SELECT l.tenant_id,
             'finance.revenue',
             'month',
             DATE_TRUNC('month', l.occurred_at),
             '',
             SUM(l.amount) / 100.0,
             'USD',
             NOW()
      FROM ledger_entries l
      WHERE l.tenant_id IS NOT NULL
        AND l.denomination = 'usd_cents'
        AND l.entry_kind IN ('grant', 'commission')
        AND l.amount > 0
        AND l.occurred_at >= DATE_TRUNC('month', NOW()) - (${WINDOW_MONTHS} * INTERVAL '1 month')
      GROUP BY l.tenant_id, DATE_TRUNC('month', l.occurred_at)
      ON CONFLICT (tenant_id, metric, bucket, bucket_at, dimension_key) DO UPDATE
        SET value = EXCLUDED.value, computed_at = NOW()
    `);
    written['finance.revenue'] = rowCount(revenue);

    // ── Cash ──────────────────────────────────────────────────────────────────────
    //
    // The running balance at the end of each month. `bucket = 'total'` on the newest
    // point would be cheaper, but the SERIES is what makes runway checkable a month
    // later — a single current balance cannot be reconciled against anything.
    const cash = await db.execute(sql`
      INSERT INTO metric_facts (tenant_id, metric, bucket, bucket_at, dimension_key, value, unit, computed_at)
      SELECT months.tenant_id,
             'finance.cash',
             'month',
             months.bucket_at,
             '',
             SUM(SUM(months.amount)) OVER (PARTITION BY months.tenant_id ORDER BY months.bucket_at) / 100.0,
             'USD',
             NOW()
      FROM (
        SELECT l.tenant_id, DATE_TRUNC('month', l.occurred_at) AS bucket_at, l.amount
        FROM ledger_entries l
        WHERE l.tenant_id IS NOT NULL AND l.denomination = 'usd_cents'
      ) AS months
      GROUP BY months.tenant_id, months.bucket_at
      ON CONFLICT (tenant_id, metric, bucket, bucket_at, dimension_key) DO UPDATE
        SET value = EXCLUDED.value, computed_at = NOW()
    `);
    written['finance.cash'] = rowCount(cash);
  } else {
    skipped.push('finance.revenue, finance.cash (ledger_entries absent)');
  }

  // ── MRR: the recurring part of revenue ─────────────────────────────────────────
  //
  // Recurring is a PROPERTY of the line, not of the month, so it reads
  // `invoice_line_items.source_kind = 'plan'` — a usage overage and a services invoice
  // are revenue and are emphatically not MRR, and a board that conflates them reports a
  // growth rate that reverses the following month.
  if (await tableExists(db, 'invoice_line_items') && await tableExists(db, 'ledger_entries')) {
    const mrr = await db.execute(sql`
      INSERT INTO metric_facts (tenant_id, metric, bucket, bucket_at, dimension_key, value, unit, computed_at)
      SELECT li.tenant_id,
             'finance.mrr',
             'month',
             DATE_TRUNC('month', l.occurred_at),
             '',
             SUM(li.amount),
             MIN(li.currency),
             NOW()
      FROM invoice_line_items li
      JOIN ledger_entries l
        ON l.tenant_id = li.tenant_id AND l.reference = li.invoice_ref
      WHERE li.tenant_id IS NOT NULL
        AND li.source_kind = 'plan'
        AND l.occurred_at >= DATE_TRUNC('month', NOW()) - (${WINDOW_MONTHS} * INTERVAL '1 month')
      GROUP BY li.tenant_id, DATE_TRUNC('month', l.occurred_at)
      ON CONFLICT (tenant_id, metric, bucket, bucket_at, dimension_key) DO UPDATE
        SET value = EXCLUDED.value, unit = EXCLUDED.unit, computed_at = NOW()
    `);
    written['finance.mrr'] = rowCount(mrr);
  } else {
    skipped.push('finance.mrr (invoice_line_items or ledger_entries absent)');
  }

  // ── Runway ─────────────────────────────────────────────────────────────────────
  //
  // cash ÷ average NET burn. Net, not gross: a company with $100k of monthly costs and
  // $80k of monthly revenue is burning $20k, and reporting its runway off the $100k
  // understates it fivefold — the single most consequential arithmetic error this file
  // could make, because a founder acts on it.
  //
  // Written ONLY where both inputs exist AND net burn is positive. A profitable tenant
  // has no runway in months, and writing a huge number would be worse than writing none:
  // `trigger` comparators are `below`, so a fabricated 9999 reads as "healthy" and a
  // fabricated 0 fires every alarm on the board.
  const runway = await db.execute(sql`
    WITH recent AS (
      SELECT tenant_id, metric, value, bucket_at,
             ROW_NUMBER() OVER (PARTITION BY tenant_id, metric ORDER BY bucket_at DESC) AS recency
      FROM metric_facts
      WHERE metric IN ('finance.burn', 'finance.revenue', 'finance.cash')
        AND bucket = 'month'
        AND dimension_key = ''
    ),
    averaged AS (
      SELECT tenant_id,
             AVG(value) FILTER (WHERE metric = 'finance.burn'    AND recency <= ${BURN_AVERAGE_MONTHS}) AS burn,
             AVG(value) FILTER (WHERE metric = 'finance.revenue' AND recency <= ${BURN_AVERAGE_MONTHS}) AS revenue,
             MAX(value) FILTER (WHERE metric = 'finance.cash'    AND recency = 1)                       AS cash
      FROM recent
      GROUP BY tenant_id
    )
    INSERT INTO metric_facts (tenant_id, metric, bucket, bucket_at, dimension_key, value, unit, computed_at)
    SELECT a.tenant_id,
           'finance.runway_months',
           'month',
           DATE_TRUNC('month', NOW()),
           '',
           LEAST(a.cash / (a.burn - COALESCE(a.revenue, 0)), 999),
           'months',
           NOW()
    FROM averaged a
    WHERE a.cash IS NOT NULL
      AND a.burn IS NOT NULL
      AND (a.burn - COALESCE(a.revenue, 0)) > 0
      AND a.cash > 0
    ON CONFLICT (tenant_id, metric, bucket, bucket_at, dimension_key) DO UPDATE
      SET value = EXCLUDED.value, computed_at = NOW()
  `);
  written['finance.runway_months'] = rowCount(runway);

  // The net monthly burn the runway was divided by, published so the two numbers on a
  // board cannot disagree about which burn produced which runway.
  const netBurn = await db.execute(sql`
    WITH recent AS (
      SELECT tenant_id, metric, value,
             ROW_NUMBER() OVER (PARTITION BY tenant_id, metric ORDER BY bucket_at DESC) AS recency
      FROM metric_facts
      WHERE metric IN ('finance.burn', 'finance.revenue')
        AND bucket = 'month'
        AND dimension_key = ''
    )
    INSERT INTO metric_facts (tenant_id, metric, bucket, bucket_at, dimension_key, value, unit, computed_at)
    SELECT r.tenant_id,
           'finance.monthly_burn',
           'month',
           DATE_TRUNC('month', NOW()),
           '',
           AVG(r.value) FILTER (WHERE r.metric = 'finance.burn'    AND r.recency <= ${BURN_AVERAGE_MONTHS})
             - COALESCE(AVG(r.value) FILTER (WHERE r.metric = 'finance.revenue' AND r.recency <= ${BURN_AVERAGE_MONTHS}), 0),
           'USD',
           NOW()
    FROM recent r
    GROUP BY r.tenant_id
    HAVING AVG(r.value) FILTER (WHERE r.metric = 'finance.burn' AND r.recency <= ${BURN_AVERAGE_MONTHS}) IS NOT NULL
    ON CONFLICT (tenant_id, metric, bucket, bucket_at, dimension_key) DO UPDATE
      SET value = EXCLUDED.value, computed_at = NOW()
  `);
  written['finance.monthly_burn'] = rowCount(netBurn);

  return {
    written,
    facts: Object.values(written).reduce((total, count) => total + count, 0),
    skipped,
  };
}
