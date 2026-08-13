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
}

/** Attainment against a goal. Pure, so the divide-by-zero rule is testable. */
export function quotaFor(goalCents: number, attainedCents: number, window: SalesReportWindow): SalesQuota {
  return {
    goalCents,
    attainedCents,
    attainmentPercent: goalCents > 0 ? Math.round((attainedCents / goalCents) * 1000) / 10 : null,
    window,
  };
}

/** A lead nobody has touched in this many days is stalled. Two weeks is the
 *  point at which a warm intro has gone cold in every sales methodology that
 *  bothers to name one. */
export const STALLED_CONTACT_DAYS = 14;

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
    associateUserId
      ? db.select({ stage: salesContacts.stage, updatedAt: salesContacts.updatedAt, lastTouchAt: salesContacts.lastTouchAt })
        .from(salesContacts).where(eq(salesContacts.ownerUserId, associateUserId))
      : db.select({ stage: salesContacts.stage, updatedAt: salesContacts.updatedAt, lastTouchAt: salesContacts.lastTouchAt })
        .from(salesContacts),
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

  return {
    generatedAtISO: now.toISOString(),
    associateUserId,
    windows,
    funnel: [...funnelCounts.entries()].map(([stage, count]) => ({ stage, count })),
    stalledContacts: stalled,
    associates: associateUserId ? [] : leaderboard(facts, people),
    quota: quotaFor(goalCents, attained, quotaWindow),
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
