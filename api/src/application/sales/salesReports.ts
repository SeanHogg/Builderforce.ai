/**
 * The sales report — ONE computation, read by two audiences.
 *
 * A sales associate asks "how am I doing this week?" and the platform owner asks
 * "how is the programme doing this month, and who is carrying it?". Those are the
 * same numbers over different populations, so they are the same function with a
 * different `associateUserId` filter — not a rep report and an admin report that
 * drift the first time a definition changes.
 *
 * ── WHAT A CRO ACTUALLY READS ────────────────────────────────────────────────
 * Four questions, in the order a revenue leader asks them:
 *
 *   1. **Did we win?**      signups, conversions, revenue, commission.
 *   2. **Will we win next?** the funnel by stage, and how much of it is stalled.
 *   3. **Is the motion healthy?** conversion rate and time-to-convert — the two
 *      leading indicators that move before revenue does.
 *   4. **Who needs help?**   per-associate rows, which is the ONLY part the rep's
 *      own view drops (there is nobody else in it).
 *
 * ── WINDOWS ──────────────────────────────────────────────────────────────────
 * Week / month / quarter / YTD / all-time, computed from ONE fetch rather than
 * one query per window. A window is a predicate over the same rows, and five
 * round-trips to answer five predicates over the same set is the fan-out the
 * performance rule names. Bounded by construction: the widest window is a single
 * associate's (or the programme's) referral history, which is a sales pipeline,
 * not a firehose.
 *
 * Pure functions over rows, so the windows are unit-testable without a database.
 */

import { and, desc, eq, gte, isNotNull } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { salesAssociateSettings, salesContacts, salesReferrals, users } from '../../infrastructure/database/schema';

export const SALES_REPORT_WINDOWS = ['week', 'month', 'quarter', 'ytd', 'all'] as const;
export type SalesReportWindow = (typeof SALES_REPORT_WINDOWS)[number];

export function isSalesReportWindow(value: unknown): value is SalesReportWindow {
  return typeof value === 'string' && (SALES_REPORT_WINDOWS as readonly string[]).includes(value);
}

/** The instant a window opens, relative to `now`. `all` opens at the epoch. */
export function windowStart(window: SalesReportWindow, now: Date): Date {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  switch (window) {
    case 'week': {
      // ISO weeks start Monday: a sales week that resets on Sunday would put the
      // Monday pipeline review at the end of the week it is reviewing.
      const day = (start.getUTCDay() + 6) % 7;
      start.setUTCDate(start.getUTCDate() - day);
      return start;
    }
    case 'month':
      start.setUTCDate(1);
      return start;
    case 'quarter':
      start.setUTCMonth(Math.floor(start.getUTCMonth() / 3) * 3, 1);
      return start;
    case 'ytd':
      start.setUTCMonth(0, 1);
      return start;
    case 'all':
    default:
      return new Date(0);
  }
}

/**
 * The instant a window CLOSES, relative to `now`.
 *
 * `windowStart` alone was enough while every read was "since": a signup either happened
 * after the boundary or it did not. A FORECAST needs both ends, because a deal expected to
 * close next quarter must not be counted toward this month's quota — the omission that
 * makes every un-windowed forecast look achievable. `all` closes at the far future for the
 * same reason it opens at the epoch.
 */
export function windowEnd(window: SalesReportWindow, now: Date): Date {
  const end = windowStart(window, now);
  switch (window) {
    case 'week': end.setUTCDate(end.getUTCDate() + 7); return end;
    case 'month': end.setUTCMonth(end.getUTCMonth() + 1); return end;
    case 'quarter': end.setUTCMonth(end.getUTCMonth() + 3); return end;
    case 'ytd': end.setUTCFullYear(end.getUTCFullYear() + 1); return end;
    case 'all':
    default:
      return new Date(8_640_000_000_000_000);
  }
}

/** The referral facts a report reads. Deliberately the narrow subset, so the
 *  windowing functions can be tested with literals. */
export interface ReferralFact {
  associateUserId: string;
  attributionType: string;
  signedUpAt: Date;
  convertedAt: Date | null;
  revenueCents: number | null;
  commissionCents: number | null;
}

export interface SalesWindowTotals {
  window: SalesReportWindow;
  signups: number;
  conversions: number;
  /** Conversions ÷ signups, as a percentage, 0 when nothing signed up. */
  conversionRatePercent: number;
  revenueCents: number;
  commissionCents: number;
  /** Mean days from signup to conversion, for conversions IN this window. */
  averageDaysToConvert: number | null;
}

/** One associate's line in the leaderboard. */
export interface SalesAssociateLine {
  associateUserId: string;
  name: string | null;
  email: string;
  signups: number;
  conversions: number;
  revenueCents: number;
  commissionCents: number;
  lastSignupAtISO: string | null;
}

export interface SalesFunnelStage {
  stage: string;
  count: number;
}

/**
 * The number, and how close it is.
 *
 * A report without a quota answers "what happened" and cannot answer "will I hit
 * it", which is the question a revenue leader actually opens a report to ask.
 * `sales_associate_settings.revenue_goal_cents` has existed since 0401 and
 * nothing read it — the goal was collectable and never compared to anything.
 *
 * `goalCents` 0 means "no goal set", NOT "a goal of zero", so attainment is null
 * rather than infinity — a divide-by-zero rendered as ∞% is worse than a blank.
 */
export interface SalesQuota {
  goalCents: number;
  attainedCents: number;
  /** Attained ÷ goal as a percentage, or null when no goal is set. */
  attainmentPercent: number | null;
  /** The window `attainedCents` is measured over. */
  window: SalesReportWindow;
  /**
   * Weighted open pipeline expected to land inside this window.
   *
   * A SEPARATE number from `attainedCents` on purpose: booked revenue and forecast revenue
   * are different confidences, and one blended "projected attainment" figure that silently
   * mixes them is how a quota meter reads green in a quarter that misses.
   */
  forecastCents: number;
  /** (attained + forecast) ÷ goal. Null when no goal is set, for the same
   *  divide-by-zero reason `attainmentPercent` is. */
  projectedPercent: number | null;
}

export interface SalesReport {
  generatedAtISO: string;
  /** Null for the aggregate view; set when filtered to one associate. */
  associateUserId: string | null;
  windows: SalesWindowTotals[];
  funnel: SalesFunnelStage[];
  /** Contacts whose last touch is older than the stall threshold. */
  stalledContacts: number;
  /** Empty for a rep's own report — there is nobody else in it. */
  associates: SalesAssociateLine[];
  /** The revenue goal for the period, and progress against it. */
  quota: SalesQuota;
  /**
   * The OPEN pipeline, weighted.
   *
   * The report could previously only answer "what happened": attainment was closed revenue
   * against a goal, so a quota meter read 20% all month and jumped on the last day. The
   * canvas has rendered `PipelineCard.valueCents` since the pipeline kanban shipped and
   * nothing could write it, so this could not be computed at all. Now it can — and
   * "attained plus weighted-open, against goal" is the number a revenue leader plans from.
   */
  pipeline: SalesPipeline;
}

/** Attainment against a goal. Pure, so the divide-by-zero rule is testable. */
export function quotaFor(
  goalCents: number,
  attainedCents: number,
  window: SalesReportWindow,
  forecastCents = 0,
): SalesQuota {
  return {
    goalCents,
    attainedCents,
    attainmentPercent: goalCents > 0 ? Math.round((attainedCents / goalCents) * 1000) / 10 : null,
    window,
    forecastCents,
    projectedPercent: goalCents > 0 ? Math.round(((attainedCents + forecastCents) / goalCents) * 1000) / 10 : null,
  };
}

/** A lead nobody has touched in this many days is stalled. Two weeks is the
 *  point at which a warm intro has gone cold in every sales methodology that
 *  bothers to name one. */
export const STALLED_CONTACT_DAYS = 14;

/**
 * How likely a deal at each stage is to close — the PIPELINE POLICY.
 *
 * ── WHY A POLICY AND NOT A COLUMN DEFAULT ────────────────────────────────────
 * `sales_contacts.probability_percent` defaults to 0, meaning "nobody has judged this
 * one". The obvious alternative was to default the column to a per-stage number, and it
 * is the wrong shape for a reason that only shows up later: a default written onto every
 * row is a policy nobody can change without a backfill, and the first time a sales leader
 * says "qualified is not 25% for us, it is 40%" you would have to rewrite history to
 * agree with them. Here it is one table, changed in one place, and every historical row
 * re-weights the moment it changes.
 *
 * The numbers are the conventional B2B ladder and are deliberately not flattering:
 * `meeting` at 30% says most first meetings do not become deals, which is the fact a
 * forecast built on optimism always hides.
 *
 * `won` is 100 and `lost` is 0 so a weighted total over EVERY row would still be correct —
 * but the open-pipeline read below excludes both anyway, because a forecast that counts
 * closed revenue as pipeline double-counts it against the quota it is compared to.
 */
export const STAGE_PROBABILITY_PERCENT: Readonly<Record<string, number>> = {
  new: 5, contacted: 10, qualified: 25, meeting: 30, proposal: 60, won: 100, lost: 0,
};

/** The probability to use for one deal: the human's judgement when they made one, the
 *  stage policy otherwise. 0 means "not overridden" — see the column comment in 0923. */
export function dealProbabilityPercent(stage: string, stored: number | null | undefined): number {
  const override = Number(stored ?? 0);
  if (Number.isFinite(override) && override > 0) return Math.min(100, Math.round(override));
  return STAGE_PROBABILITY_PERCENT[stage] ?? 0;
}

/** One open deal, reduced to what a forecast needs. */
export interface PipelineDeal {
  stage: string;
  valueCents: number;
  probabilityPercent: number | null;
  expectedCloseAt: Date | null;
}

export interface SalesPipelineStage {
  stage: string;
  count: number;
  valueCents: number;
  /** Value x probability. The number a forecast is actually made of. */
  weightedCents: number;
  /** Deals in this stage carrying no value at all. Surfaced rather than hidden, because a
   *  pipeline that looks small is usually one nobody has priced. */
  unpriced: number;
}

export interface SalesPipeline {
  stages: SalesPipelineStage[];
  openCount: number;
  openValueCents: number;
  weightedCents: number;
  /** Open deals with `value_cents = 0`. The honesty figure: a weighted pipeline computed
   *  over half-priced data is a number nobody should plan from, and this says how much of
   *  it is missing. */
  unpricedCount: number;
  /** The weighted value expected to land inside the quota window. `null` when no deal
   *  carries an expected close date at all — a different answer from "nothing lands this
   *  month", and the two must not render the same. */
  weightedInWindowCents: number | null;
}

/**
 * Roll open deals into a weighted pipeline. Pure, hence testable without a database.
 */
export function summarizePipeline(
  deals: readonly PipelineDeal[],
  window: { from: Date; to: Date } | null,
): SalesPipeline {
  const byStage = new Map<string, SalesPipelineStage>();
  let openCount = 0;
  let openValueCents = 0;
  let weightedCents = 0;
  let unpricedCount = 0;
  let weightedInWindow = 0;
  let anyDated = false;

  for (const deal of deals) {
    if (deal.stage === 'won' || deal.stage === 'lost') continue;
    const probability = dealProbabilityPercent(deal.stage, deal.probabilityPercent);
    const value = Math.max(0, deal.valueCents);
    const weighted = Math.round((value * probability) / 100);

    const row = byStage.get(deal.stage)
      ?? { stage: deal.stage, count: 0, valueCents: 0, weightedCents: 0, unpriced: 0 };
    row.count += 1;
    row.valueCents += value;
    row.weightedCents += weighted;
    if (value === 0) row.unpriced += 1;
    byStage.set(deal.stage, row);

    openCount += 1;
    openValueCents += value;
    weightedCents += weighted;
    if (value === 0) unpricedCount += 1;

    if (deal.expectedCloseAt) {
      anyDated = true;
      if (window && deal.expectedCloseAt >= window.from && deal.expectedCloseAt <= window.to) {
        weightedInWindow += weighted;
      }
    }
  }

  // Stage order follows the POLICY, not insertion order: a funnel drawn in the order rows
  // happened to arrive is one nobody can read left to right. A stage the policy does not
  // know is appended rather than dropped, so a custom stage is visible and unweighted
  // instead of silently absent.
  const known = Object.keys(STAGE_PROBABILITY_PERCENT)
    .flatMap((stage) => { const row = byStage.get(stage); return row ? [row] : []; });
  const unknown = [...byStage.values()].filter((row) => !(row.stage in STAGE_PROBABILITY_PERCENT));

  return {
    stages: [...known, ...unknown],
    openCount,
    openValueCents,
    weightedCents,
    unpricedCount,
    weightedInWindowCents: anyDated && window ? weightedInWindow : null,
  };
}

const MS_PER_DAY = 86_400_000;

/** Totals for one window over already-fetched rows. Pure, hence testable. */
export function totalsForWindow(facts: readonly ReferralFact[], window: SalesReportWindow, now: Date): SalesWindowTotals {
  const from = windowStart(window, now).getTime();
  const signups = facts.filter((fact) => fact.signedUpAt.getTime() >= from);
  const conversions = facts.filter((fact) => fact.convertedAt != null && fact.convertedAt.getTime() >= from);
  const dayGaps = conversions
    .map((fact) => (fact.convertedAt!.getTime() - fact.signedUpAt.getTime()) / MS_PER_DAY)
    .filter((days) => Number.isFinite(days) && days >= 0);

  return {
    window,
    signups: signups.length,
    conversions: conversions.length,
    // Rate is conversions-in-window over signups-in-window: the honest reading of
    // "how is this week going". A cohort rate (did THESE signups convert?) is a
    // different question and would need a different denominator.
    conversionRatePercent: signups.length === 0 ? 0 : Math.round((conversions.length / signups.length) * 1000) / 10,
    revenueCents: conversions.reduce((sum, fact) => sum + (fact.revenueCents ?? 0), 0),
    commissionCents: conversions.reduce((sum, fact) => sum + (fact.commissionCents ?? 0), 0),
    averageDaysToConvert: dayGaps.length === 0 ? null : Math.round((dayGaps.reduce((a, b) => a + b, 0) / dayGaps.length) * 10) / 10,
  };
}

/** Every window, from one pass over the rows. */
export function allWindows(facts: readonly ReferralFact[], now: Date): SalesWindowTotals[] {
  return SALES_REPORT_WINDOWS.map((window) => totalsForWindow(facts, window, now));
}

/** Leaderboard rows, biggest commission first — the order a CRO reads them in. */
export function leaderboard(
  facts: readonly ReferralFact[],
  people: ReadonlyMap<string, { name: string | null; email: string }>,
): SalesAssociateLine[] {
  const byAssociate = new Map<string, SalesAssociateLine>();
  for (const fact of facts) {
    const person = people.get(fact.associateUserId);
    const line = byAssociate.get(fact.associateUserId) ?? {
      associateUserId: fact.associateUserId,
      name: person?.name ?? null,
      email: person?.email ?? '',
      signups: 0, conversions: 0, revenueCents: 0, commissionCents: 0, lastSignupAtISO: null,
    };
    line.signups += 1;
    if (fact.convertedAt) {
      line.conversions += 1;
      line.revenueCents += fact.revenueCents ?? 0;
      line.commissionCents += fact.commissionCents ?? 0;
    }
    const signedUp = fact.signedUpAt.toISOString();
    if (!line.lastSignupAtISO || signedUp > line.lastSignupAtISO) line.lastSignupAtISO = signedUp;
    byAssociate.set(fact.associateUserId, line);
  }
  return [...byAssociate.values()].sort((a, b) => b.commissionCents - a.commissionCents || b.signups - a.signups);
}

/**
 * Build the report.
 *
 * `associateUserId` null means the AGGREGATE (every associate) — which is the
 * superadmin's view, and the only difference between the two audiences.
 */
export async function buildSalesReport(
  db: Db,
  tenantId: number,
  options: { associateUserId?: string | null; now?: Date; quotaWindow?: SalesReportWindow } = {},
): Promise<SalesReport> {
  const now = options.now ?? new Date();
  const associateUserId = options.associateUserId ?? null;
  // Month is the period a revenue goal is set and reviewed in. Defaulting to
  // 'all' would make attainment meaningless — every goal is eventually met if
  // you wait long enough.
  const quotaWindow: SalesReportWindow = options.quotaWindow ?? 'month';

  // The aggregate view is "every associate IN THIS WORKSPACE" — a referral is a
  // workspace's fact about its own programme, so even the superadmin roll-up is
  // scoped. Reading across tenants here would total another workspace's revenue
  // into this one's leaderboard.
  const referralWhere = associateUserId
    ? and(eq(salesReferrals.associateUserId, associateUserId), isNotNull(salesReferrals.signupNotifiedAt))
    : isNotNull(salesReferrals.signupNotifiedAt);

  const stalledBefore = new Date(now.getTime() - STALLED_CONTACT_DAYS * MS_PER_DAY);

  const [referralRows, contactRows, peopleRows, goalRows] = await Promise.all([
    db.select({
      associateUserId: salesReferrals.associateUserId,
      attributionType: salesReferrals.attributionType,
      signedUpAt: salesReferrals.signedUpAt,
      convertedAt: salesReferrals.convertedAt,
      revenueCents: salesReferrals.revenueCents,
      commissionCents: salesReferrals.commissionCents,
    }).from(salesReferrals)
      .where(and(eq(salesReferrals.tenantId, tenantId), referralWhere))
      .orderBy(desc(salesReferrals.signedUpAt)),
    // The funnel is a GROUP BY, not a fetch-and-count: a programme-wide contact
    // list is unbounded and there is no reason to carry it into the Worker.
    // The same single fetch now also carries the MONEY, so the weighted pipeline costs no
    // extra round trip — the funnel and the forecast are two readings of one set of rows,
    // which is why they are computed together rather than by a second endpoint.
    associateUserId
      ? db.select({
        stage: salesContacts.stage, updatedAt: salesContacts.updatedAt, lastTouchAt: salesContacts.lastTouchAt,
        valueCents: salesContacts.valueCents, probabilityPercent: salesContacts.probabilityPercent,
        expectedCloseAt: salesContacts.expectedCloseAt,
      }).from(salesContacts).where(eq(salesContacts.ownerUserId, associateUserId))
      : db.select({
        stage: salesContacts.stage, updatedAt: salesContacts.updatedAt, lastTouchAt: salesContacts.lastTouchAt,
        valueCents: salesContacts.valueCents, probabilityPercent: salesContacts.probabilityPercent,
        expectedCloseAt: salesContacts.expectedCloseAt,
      }).from(salesContacts),
    associateUserId
      ? Promise.resolve([] as Array<{ id: string; name: string | null; email: string }>)
      : db.select({ id: users.id, name: users.displayName, email: users.email })
        .from(users).where(eq(users.accountType, 'sales')),
    // The goal: ONE associate's when filtered, every associate's summed for the
    // aggregate — a programme quota IS the sum of its people's, so there is no
    // second place to store it and nothing to keep in sync.
    associateUserId
      ? db.select({ goalCents: salesAssociateSettings.revenueGoalCents }).from(salesAssociateSettings)
        .where(eq(salesAssociateSettings.ownerUserId, associateUserId))
      : db.select({ goalCents: salesAssociateSettings.revenueGoalCents }).from(salesAssociateSettings),
  ]);

  const facts: ReferralFact[] = referralRows.map((row) => ({
    associateUserId: row.associateUserId,
    attributionType: row.attributionType,
    signedUpAt: row.signedUpAt,
    convertedAt: row.convertedAt,
    revenueCents: row.revenueCents,
    commissionCents: row.commissionCents,
  }));

  const funnelCounts = new Map<string, number>();
  let stalled = 0;
  for (const contact of contactRows) {
    funnelCounts.set(contact.stage, (funnelCounts.get(contact.stage) ?? 0) + 1);
    const touched = contact.lastTouchAt ?? contact.updatedAt;
    // Won and lost are finished, not stalled — counting them would make every
    // successful associate look neglectful.
    if (contact.stage !== 'won' && contact.stage !== 'lost' && touched < stalledBefore) stalled += 1;
  }

  const people = new Map(peopleRows.map((row) => [row.id, { name: row.name, email: row.email }]));

  const windows = allWindows(facts, now);
  // Attainment is measured in ATTRIBUTED REVENUE, not commission: a quota is what
  // the business booked through this person, and commission is their share of it.
  const attained = windows.find((row) => row.window === quotaWindow)?.revenueCents ?? 0;
  const goalCents = goalRows.reduce((sum, row) => sum + (row.goalCents ?? 0), 0);

  // The forecast window IS the quota window: a forecast measured over a different period
  // from the goal it is compared to is not a forecast, it is two unrelated numbers on one
  // meter. `windowStart`/`windowEnd` already own the period arithmetic, so it is reused.
  const pipeline = summarizePipeline(
    contactRows.map((row) => ({
      stage: row.stage,
      valueCents: row.valueCents ?? 0,
      probabilityPercent: row.probabilityPercent ?? null,
      expectedCloseAt: row.expectedCloseAt ?? null,
    })),
    { from: windowStart(quotaWindow, now), to: windowEnd(quotaWindow, now) },
  );

  return {
    generatedAtISO: now.toISOString(),
    associateUserId,
    windows,
    funnel: [...funnelCounts.entries()].map(([stage, count]) => ({ stage, count })),
    stalledContacts: stalled,
    associates: associateUserId ? [] : leaderboard(facts, people),
    quota: quotaFor(goalCents, attained, quotaWindow, pipeline.weightedInWindowCents ?? 0),
    pipeline,
  };
}

/** Commission EARNED to date (converted referrals), which is what the payout
 *  balance subtracts from. One SUM, and the one definition of "earned". */
export async function earnedCommissionCents(db: Db, tenantId: number, associateUserId: string): Promise<number> {
  const rows = await db.select({ commissionCents: salesReferrals.commissionCents })
    .from(salesReferrals)
    .where(and(
      eq(salesReferrals.tenantId, tenantId),
      eq(salesReferrals.associateUserId, associateUserId),
      isNotNull(salesReferrals.convertedAt),
    ));
  return rows.reduce((sum, row) => sum + (row.commissionCents ?? 0), 0);
}

/** Referrals that signed up since `from` — the "current leads" list the hub shows. */
export async function recentReferrals(db: Db, tenantId: number, associateUserId: string, from: Date) {
  return db.select({
    id: salesReferrals.id,
    attributionType: salesReferrals.attributionType,
    signedUpAt: salesReferrals.signedUpAt,
    convertedAt: salesReferrals.convertedAt,
    plan: salesReferrals.plan,
    revenueCents: salesReferrals.revenueCents,
    commissionCents: salesReferrals.commissionCents,
  }).from(salesReferrals)
    .where(and(
      eq(salesReferrals.tenantId, tenantId),
      eq(salesReferrals.associateUserId, associateUserId),
      gte(salesReferrals.signedUpAt, from),
    ))
    .orderBy(desc(salesReferrals.signedUpAt));
}
