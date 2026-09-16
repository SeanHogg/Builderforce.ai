/**
 * FOUNDER METRICS (PRD 25 A3) — the scalars a founder dashboard is made of.
 *
 * These are registry entries like any other: they are spread into
 * `METRIC_REGISTRY`, so a preset tile, an NL query and a custom dashboard all
 * reach them through the same whitelist, and nothing downstream needs to know
 * the founder layer exists.
 *
 * ── NULL MEANS NOT MEASURED ─────────────────────────────────────────────────
 * Every compute here returns `null` rather than `0` when the underlying fact has
 * not been recorded: a workspace that has never declared its finances has no
 * runway, and a company with no equity ledger has no ownership. Zero would be a
 * claim — "you have no cash", "you own none of your company" — and it is a claim
 * that reads as catastrophic. The widget renders null as "not measured yet" with
 * the affordance to record it, which is the honest and the useful answer.
 *
 * ── WHY NO ENV ──────────────────────────────────────────────────────────────
 * `MetricDef.compute` is `(db, tenantId, days)`. That signature has nowhere to
 * put a Cloudflare `Env`, so these call the uncached folds — `runwayReport` with
 * `undefined` env and `computeCapTable` — rather than their cached wrappers. The
 * dashboards route already caches resolved metric values on a short TTL, so the
 * work is done once per window regardless.
 */

import type { Db } from '../../infrastructure/database/connection';
import { companyKey, computeCapTable, cliffsDueWithin } from '../finance/equity';
import { runwayReport } from '../finance/runwayReport';
import type { MetricDef } from './metricRegistry';

/** Days inside which a vesting cliff counts as "coming up" on the founder tile. */
const CLIFF_HORIZON_DAYS = 90;

/** Milliseconds in a day — for turning an ISO date into a UTC day number. */
const MS_PER_DAY = 86_400_000;

/**
 * The company a founder metric is about.
 *
 * A workspace can hold several companies; the runway report already answers
 * "which one does an undirected question mean?" — the most recently declared,
 * falling back to the most recently updated. Reusing its answer rather than
 * re-deriving one keeps the dashboard tile and the `/finance` page describing the
 * same company, which is the whole reason the number is trustworthy.
 */
async function primaryCompany(db: Db, tenantId: number) {
  const report = await runwayReport(db, undefined, tenantId, null);
  return report.declared;
}

/**
 * Cap table for the primary company, or `null` when there is no company or no
 * ledger. Empty is never an error: a real workspace may simply not have recorded
 * its formation yet.
 */
async function primaryCapTable(db: Db, tenantId: number) {
  const declared = await primaryCompany(db, tenantId);
  if (!declared) return null;
  const table = await computeCapTable(
    db,
    tenantId,
    companyKey(String(declared.companyId)),
    new Date().toISOString(),
  );
  return table.fullyDiluted > 0 ? table : null;
}

export const FOUNDER_METRICS: Record<string, MetricDef> = {
  // ── Runway ────────────────────────────────────────────────────────────────
  'finance.runwayMonths': {
    label: 'Runway',
    unit: 'months',
    description: 'Months of cash left at the declared net burn rate.',
    goodWhenUp: true,
    async compute(db, tenantId) {
      const declared = await primaryCompany(db, tenantId);
      // `runway` is null when finances were never declared, and
      // `runwayMonths` is null when the company is profitable — net burn at or
      // below zero means the cash never runs out, which is not "0 months left".
      return declared?.runway?.runwayMonths ?? null;
    },
  },

  'finance.cash': {
    label: 'Cash on hand',
    unit: 'USD',
    description: 'Declared cash balance, falling back to the latest observed balance.',
    goodWhenUp: true,
    async compute(db, tenantId) {
      const report = await runwayReport(db, undefined, tenantId, null);
      // The founder's own declaration wins over the ledger: they know about the
      // wire that has not cleared yet, and the tile is theirs to reconcile.
      return report.declared?.finance.cashOnHand ?? report.observed.cash ?? null;
    },
    async series(db, tenantId) {
      const report = await runwayReport(db, undefined, tenantId, null);
      return report.observed.months
        .filter((month) => month.cash != null)
        .map((month) => ({ day: `${month.month}-01`, value: month.cash as number }));
    },
  },

  'finance.netBurn': {
    label: 'Net burn',
    unit: 'USD',
    description: 'Monthly cash out minus cash in, at the declared rate.',
    goodWhenUp: false,
    async compute(db, tenantId) {
      const declared = await primaryCompany(db, tenantId);
      return declared?.runway?.netBurn ?? null;
    },
    async series(db, tenantId) {
      const report = await runwayReport(db, undefined, tenantId, null);
      return report.observed.months
        .filter((month) => month.burn != null)
        .map((month) => ({ day: `${month.month}-01`, value: month.burn as number }));
    },
  },

  'finance.cashZeroDate': {
    label: 'Cash zero date',
    // Rendered as a date, not a count — the formatter branches on this unit.
    unit: 'date',
    description: 'The date the balance reaches zero at the current net burn.',
    async compute(db, tenantId) {
      const declared = await primaryCompany(db, tenantId);
      const zero = declared?.runway?.zeroCashDate;
      if (!zero) return null;
      const ms = Date.parse(zero);
      if (Number.isNaN(ms)) return null;
      // A metric is a number by contract, so the date travels as a UTC day
      // number and the frontend formatter turns it back into a date. Storing it
      // as an epoch millisecond would overflow the widget's number formatting.
      return Math.floor(ms / MS_PER_DAY);
    },
  },

  // ── Ownership ─────────────────────────────────────────────────────────────
  'equity.founderOwnership': {
    label: 'Founder ownership',
    unit: '%',
    description: 'Largest individual holding as a percentage of fully diluted shares.',
    goodWhenUp: true,
    async compute(db, tenantId) {
      const table = await primaryCapTable(db, tenantId);
      if (!table) return null;
      // There is deliberately no `founder` role in `party_roles` — equity writes
      // `equity_holder` and nothing else — so this reports the LARGEST
      // individual holding rather than inventing a role the ledger does not
      // record. For the overwhelming majority of pre-exit cap tables that is the
      // founder, and when it is not, the ownership widget shows every holder so
      // the reader can see exactly whose number this is. Option-pool rows are
      // excluded: the pool is not a person.
      const individual = table.holders.filter((holder) => holder.instrument !== 'option');
      if (!individual.length) return null;
      return individual.reduce(
        (top, holder) => Math.max(top, holder.percentFullyDiluted),
        0,
      );
    },
  },

  'equity.poolUnallocated': {
    label: 'Unallocated option pool',
    unit: '%',
    description: 'Authorised option pool not yet granted, as a percentage of fully diluted.',
    async compute(db, tenantId) {
      const table = await primaryCapTable(db, tenantId);
      if (!table) return null;
      // Reported as a PERCENTAGE, not a share count: "400,000 shares" means
      // nothing without the denominator, and the question this tile answers is
      // "how much room do I have left to hire?".
      return Math.round((table.poolUnallocated / table.fullyDiluted) * 10_000) / 100;
    },
  },

  'equity.cliffsDue90d': {
    label: 'Cliffs due in 90 days',
    unit: '',
    description: 'Vesting cliffs landing within the next 90 days.',
    async compute(db, tenantId) {
      // No `goodWhenUp`: a cliff arriving is neither good nor bad, it is simply
      // a thing that needs a conversation booked before it happens.
      const due = await cliffsDueWithin(db, tenantId, CLIFF_HORIZON_DAYS, Date.now());
      return due.length;
    },
  },
};
