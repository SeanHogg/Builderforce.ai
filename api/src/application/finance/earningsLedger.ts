/**
 * EARNINGS AND TRANSACTION HISTORY — the report over books that are already correct.
 *
 * ── WHY THIS IS A READ AND NOTHING ELSE ──────────────────────────────────────────
 * Nothing in this file writes. `ledger_entries` already records every movement this
 * report describes: a catalogue sale credits the seller (`creditSeller`), an escrow
 * release credits the freelancer (`milestones.ts`), a withdrawal debits them
 * (`PayoutAccountService.pay`), and each one is idempotent on a unique reference. The
 * gap was never the books — it was that a person had no way to READ them. So this is a
 * projection, and the moment it starts computing a balance of its own it has become a
 * second set of books that can disagree with the first.
 *
 * ── THE FOUR KINDS OF ROW, AND WHY THE CLASSIFIER IS A FUNCTION ──────────────────
 * Every row this report touches sits on ONE account: `('user', <userId>, 'usd_cents')`.
 * That is deliberate platform-wide (see `creditSeller`'s note — a separate `seller`
 * account would make earned and paid unsubtractable), and it means `entry_kind` alone
 * cannot say what a row MEANS. In particular `payout` is written by two very different
 * events:
 *
 *   • `milestones.ts` writes `payout` when escrow RELEASES money TO the freelancer —
 *     that is money they earned;
 *   • `PayoutAccountService.pay` writes `payout` when money LEAVES to their bank —
 *     that is money going out.
 *
 * Both are positive amounts on the same account. The only thing that separates them is
 * the reference: escrow's is `escrow:<milestoneId>:<action>`, minted by
 * `escrowLedgerReference()`. `classifyLedgerEntry` is that rule, written once, and
 * `EARNING_SQL` / `WITHDRAWAL_SQL` below are the same rule in SQL, declared adjacent so
 * a reader can check them against each other in one glance.
 *
 * (A KNOWN CONSEQUENCE, reported rather than silently worked around:
 * `PayoutAccountService.paidCents` sums every `payout` row without this distinction, so
 * an escrow release inflates the "already paid out" figure the MARKETPLACE seller
 * balance subtracts. That module is outside this change's ownership; this report does
 * not inherit the conflation.)
 *
 * ── WHERE THE FEE COMES FROM ─────────────────────────────────────────────────────
 * The ledger records the platform's cut as a row against `partner/platform`, which is
 * correct for the platform's books and useless for a seller's: it carries no seller
 * reference, so it cannot be attributed back without an order join. The attributable
 * fact is `order_line_items.commission_cents`, stamped with `seller_ref` at the moment
 * of sale precisely so that changing the rate tomorrow cannot re-price what somebody
 * sold today. So the money comes from the ledger and the FEE comes from the stamped
 * order line — one source each, and `gross = net + fee` rather than a third stored
 * total that the other two could contradict.
 *
 * ── SCOPE: ONE WORKSPACE, OR EVERYWHERE ──────────────────────────────────────────
 * A tenant-authenticated seller asks about THIS workspace. A for-hire freelancer holds
 * a web JWT, belongs to no workspace, and is asking about every workspace that has ever
 * paid them — `tenantScope.ts`'s `subject_own_rows`, whose access predicate (the
 * verified subject from the JWT) is strictly narrower than a tenant filter would be.
 * Both shapes are served here so there is one report, not two that drift.
 */

import { and, desc, eq, gte, lt, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  bumpCacheVersion,
  getCacheVersion,
  getOrSetCached,
} from '../../infrastructure/cache/readThroughCache';
import {
  engagementMilestones,
  ledgerEntries,
  orderLineItems,
  orders,
  tenants,
} from '../../infrastructure/database/schema';
import { acrossTenants, scopedToTenant } from '../../infrastructure/database/tenantScope';
import { MILESTONE_STATUSES, isHoldingFunds } from '../marketplace/escrow';
import { settlementMode, type SettlementMode } from '../integrations/payments';
import { quotePlatformFee, USD_CENTS, type PlatformFeeQuote } from './platformFees';

// ---------------------------------------------------------------------------
// The classifier — one rule, stated twice (TypeScript and SQL), on purpose
// ---------------------------------------------------------------------------

/** What a ledger row on a person's account MEANS. */
export type EarningKind =
  /** A catalogue sale credited to the seller, net of the platform fee. */
  | 'sale'
  /** An escrow milestone released to the freelancer. */
  | 'escrow_release'
  /** A reversed sale — written as a negative entry, never as a subtraction. */
  | 'refund'
  /** Money that left to the person's own payout destination. */
  | 'withdrawal'
  /** Anything else on the account: a grant, a manual correction. */
  | 'adjustment';

/** The reference prefix `escrowLedgerReference()` mints. The one token that tells an
 *  escrow release apart from a bank withdrawal on the same account. */
const ESCROW_REFERENCE_PREFIX = 'escrow:';

/**
 * What one row is. Pure, exported, and asserted in a table test — the SQL predicates
 * below MUST agree with it, and a test that walks every `entry_kind` is the only thing
 * that keeps them honest.
 */
export function classifyLedgerEntry(entryKind: string, reference: string | null): EarningKind {
  if (entryKind === 'commission') return 'sale';
  if (entryKind === 'refund') return 'refund';
  if (entryKind === 'payout') {
    return (reference ?? '').startsWith(ESCROW_REFERENCE_PREFIX) ? 'escrow_release' : 'withdrawal';
  }
  return 'adjustment';
}

/** True when this row is money the person EARNED (positive or, for a refund, negative)
 *  rather than money moving out of the platform. */
export function isEarningKind(kind: EarningKind): boolean {
  return kind === 'sale' || kind === 'escrow_release' || kind === 'refund';
}

/** `classifyLedgerEntry(...)` is an earning — in SQL. Kept beside its TypeScript twin. */
const EARNING_SQL = sql`(
  ${ledgerEntries.entryKind} in ('commission', 'refund')
  or (${ledgerEntries.entryKind} = 'payout' and ${ledgerEntries.reference} like ${`${ESCROW_REFERENCE_PREFIX}%`})
)`;

/** `classifyLedgerEntry(...) === 'withdrawal'` — in SQL. */
const WITHDRAWAL_SQL = sql`(
  ${ledgerEntries.entryKind} = 'payout'
  and (${ledgerEntries.reference} is null or ${ledgerEntries.reference} not like ${`${ESCROW_REFERENCE_PREFIX}%`})
)`;

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

export const EARNINGS_PERIODS = ['week', 'month', 'quarter', 'year'] as const;
export type EarningsPeriod = (typeof EARNINGS_PERIODS)[number];

export function isEarningsPeriod(value: unknown): value is EarningsPeriod {
  return typeof value === 'string' && (EARNINGS_PERIODS as readonly string[]).includes(value);
}

/**
 * The `date_trunc` unit and the label format for each period.
 *
 * A closed map rather than string interpolation into SQL: `date_trunc($1, …)` with a
 * value off the query string is how a report grows an injection point, and a map means
 * an unknown period cannot reach Postgres at all.
 */
const PERIOD_SQL: Readonly<Record<EarningsPeriod, { unit: string; label: string }>> = {
  week:    { unit: 'week',    label: 'IYYY-"W"IW' },
  month:   { unit: 'month',   label: 'YYYY-MM' },
  quarter: { unit: 'quarter', label: 'YYYY-"Q"Q' },
  year:    { unit: 'year',    label: 'YYYY' },
};

/** `to_char(date_trunc(<unit>, <column>), <label>)` for a period, with both halves
 *  taken from the closed map above. */
function periodLabel(period: EarningsPeriod, column: SQL | ReturnType<typeof sql.raw>): SQL<string> {
  const spec = PERIOD_SQL[period];
  return sql<string>`to_char(date_trunc(${spec.unit}, ${column}), ${spec.label})`;
}

// ---------------------------------------------------------------------------
// The shapes a surface renders
// ---------------------------------------------------------------------------

/** One movement, as a person reads it on a statement. */
export interface EarningsTransaction {
  id: number;
  occurredAtISO: string;
  kind: EarningKind;
  /** Signed exactly as booked, so a refund reads negative rather than needing a rule. */
  amountCents: number;
  /** What the platform took on this line. 0 for everything that is not a sale — see
   *  the module header on where the fee applies. */
  feeCents: number;
  /** `amountCents + feeCents` for a sale; `amountCents` otherwise. */
  grossCents: number;
  reference: string | null;
  memo: string | null;
  /** Which workspace this movement belongs to, and what it is called. A freelancer's
   *  statement spans many, and "who paid me" is the first question they ask of a row. */
  tenantId: number;
  workspaceName: string | null;
}

/** One period's totals. */
export interface EarningsBucket {
  period: string;
  grossCents: number;
  feeCents: number;
  netCents: number;
  count: number;
}

/** The numbers at the top of the report. */
export interface EarningsSummary {
  /** Everything earned before the platform's cut. */
  grossCents: number;
  /** The platform's cut, from the stamped order lines. */
  platformFeeCents: number;
  /** What actually landed in the account — the ledger's own sum. */
  netCents: number;
  /** Money that has left to a payout destination. */
  withdrawnCents: number;
  /** Refunds, as a positive magnitude (already netted into `netCents`). */
  refundedCents: number;
  /** Escrow money the platform is holding for this person right now — agreed and
   *  funded, not yet released. Derived from milestone statuses, never stored. */
  heldCents: number;
  /** Earned minus withdrawn, floored at zero. */
  availableCents: number;
  transactionCount: number;
}

export interface EarningsReport {
  scope: 'workspace' | 'everywhere';
  currency: 'USD';
  fromISO: string;
  toISO: string;
  period: EarningsPeriod;
  summary: EarningsSummary;
  buckets: EarningsBucket[];
  transactions: EarningsTransaction[];
  /** Whether the transaction list was truncated, so the surface can say so rather
   *  than letting a person believe a page is the whole history. */
  transactionsTruncated: boolean;
  /** The fee model as it stands for this person's NEXT sale, and why. */
  fee: PlatformFeeQuote;
  /** Honest degradation, surfaced rather than hidden: with no payout provider
   *  configured the ledger is still correct and a transfer waits for an operator. */
  settlement: SettlementMode;
}

export interface EarningsQuery {
  /** The workspace to scope to, or null for the cross-tenant subject view. */
  tenantId: number | null;
  userId: string;
  from: Date;
  to: Date;
  period: EarningsPeriod;
  /** How many individual movements to list. Capped — the summary and the buckets are
   *  SQL aggregates and stay exact however long the history is. */
  limit?: number;
}

/** The most movements one page of the statement will list. */
const MAX_TRANSACTIONS = 500;
const DEFAULT_TRANSACTIONS = 100;

// ---------------------------------------------------------------------------
// Caching
// ---------------------------------------------------------------------------

/**
 * The version token every cached earnings key embeds.
 *
 * A VERSION rather than a key list, because the keyspace is unbounded: the range, the
 * period and the page size are all caller-chosen, so there is no enumerable set of keys
 * a write could invalidate. Bumping the token orphans every one of this person's cached
 * reports at once, which is exactly what a movement on their account should do.
 *
 * Keyed by USER and not by tenant, because the cross-tenant report spans workspaces —
 * a release in one workspace has to invalidate the everywhere view too.
 */
export function earningsVersionKey(userId: string): string {
  return `earnings:user:${userId}`;
}

/** Called by every writer that moves money on a person's account. */
export async function invalidateEarnings(env: Env, userId: string): Promise<void> {
  await bumpCacheVersion(env, earningsVersionKey(userId));
}

function earningsCacheKey(version: string, query: Required<Omit<EarningsQuery, 'from' | 'to'>> & { fromISO: string; toISO: string }): string {
  return [
    'earnings:v1',
    query.userId,
    query.tenantId == null ? 'all' : `t${query.tenantId}`,
    query.period,
    query.fromISO,
    query.toISO,
    String(query.limit),
    `v:${version}`,
  ].join(':');
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

const num = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
};

/**
 * The subject predicate.
 *
 * Scoped to the workspace when there is one; declared cross-tenant when there is not.
 * `subject_own_rows` is the reason and the access control is the predicate itself —
 * `account_ref = <the authenticated caller>`, which returns rows for exactly one person
 * where a tenant filter would return rows for everyone in a workspace.
 */
function ledgerScope(tenantId: number | null, userId: string, from: Date, to: Date): SQL {
  const subject = and(
    eq(ledgerEntries.accountKind, 'user'),
    eq(ledgerEntries.accountRef, userId),
    eq(ledgerEntries.denomination, USD_CENTS),
    gte(ledgerEntries.occurredAt, from),
    lt(ledgerEntries.occurredAt, to),
  );
  return tenantId == null
    ? acrossTenants(ledgerEntries, 'subject_own_rows', subject)
    : scopedToTenant(ledgerEntries, tenantId, subject);
}

/**
 * WHAT THIS PERSON HAS EARNED, AND EVERY MOVEMENT BEHIND IT.
 *
 * Read-through cached under a per-user version token (see `earningsVersionKey`), so a
 * release, a sale or a dispute ruling shows up on the next read rather than the next
 * TTL. The TTL is a backstop for the writers this module cannot see, not the mechanism.
 */
export async function readEarningsReport(db: Db, env: Env, query: EarningsQuery): Promise<EarningsReport> {
  const limit = Math.min(MAX_TRANSACTIONS, Math.max(1, Math.floor(query.limit ?? DEFAULT_TRANSACTIONS)));
  const version = await getCacheVersion(env, earningsVersionKey(query.userId));
  const key = earningsCacheKey(version, {
    tenantId: query.tenantId,
    userId: query.userId,
    period: query.period,
    limit,
    fromISO: query.from.toISOString(),
    toISO: query.to.toISOString(),
  });
  return getOrSetCached(
    env,
    key,
    () => buildEarningsReport(db, env, { ...query, limit }),
    { kvTtlSeconds: 120, l1TtlMs: 15_000 },
  );
}

async function buildEarningsReport(db: Db, env: Env, query: EarningsQuery & { limit: number }): Promise<EarningsReport> {
  const scope = ledgerScope(query.tenantId, query.userId, query.from, query.to);

  const [totals, ledgerBuckets, rows, feeTotals, feeBuckets, held, fee] = await Promise.all([
    // The summary is a SQL aggregate over the WHOLE range — exact however long the
    // history is, and unaffected by the page size of the list below it.
    db.select({
      net: sql<string>`coalesce(sum(${ledgerEntries.amount}) filter (where ${EARNING_SQL}), 0)`,
      withdrawn: sql<string>`coalesce(sum(abs(${ledgerEntries.amount})) filter (where ${WITHDRAWAL_SQL}), 0)`,
      refunded: sql<string>`coalesce(sum(abs(${ledgerEntries.amount})) filter (where ${ledgerEntries.entryKind} = 'refund'), 0)`,
      count: sql<string>`count(*) filter (where ${EARNING_SQL})`,
    }).from(ledgerEntries).where(scope),

    db.select({
      period: periodLabel(query.period, sql`${ledgerEntries.occurredAt}`),
      net: sql<string>`coalesce(sum(${ledgerEntries.amount}), 0)`,
      count: sql<string>`count(*)`,
    }).from(ledgerEntries)
      .where(and(scope, EARNING_SQL))
      .groupBy(periodLabel(query.period, sql`${ledgerEntries.occurredAt}`))
      .orderBy(periodLabel(query.period, sql`${ledgerEntries.occurredAt}`)),

    db.select({
      id: ledgerEntries.id,
      occurredAt: ledgerEntries.occurredAt,
      entryKind: ledgerEntries.entryKind,
      amount: ledgerEntries.amount,
      reference: ledgerEntries.reference,
      memo: ledgerEntries.memo,
      tenantId: ledgerEntries.tenantId,
      workspaceName: tenants.name,
    }).from(ledgerEntries)
      .leftJoin(tenants, eq(tenants.id, ledgerEntries.tenantId))
      .where(scope)
      .orderBy(desc(ledgerEntries.occurredAt), desc(ledgerEntries.id))
      // One more than the page, so "is there more" is answered by the query rather
      // than guessed from a full page.
      .limit(query.limit + 1),

    feeTotalQuery(db, query),
    feeBucketQuery(db, query),
    heldCentsFor(db, query.tenantId, query.userId),
    quotePlatformFee(db, env, { tenantId: query.tenantId, ref: query.userId }),
  ]);

  const totalRow = totals[0];
  const netCents = num(totalRow?.net);
  const platformFeeCents = num(feeTotals);
  const withdrawnCents = num(totalRow?.withdrawn);

  const feeByOrder = await feesForListedOrders(db, query, rows.map((row) => row.reference));

  const truncated = rows.length > query.limit;
  const page = truncated ? rows.slice(0, query.limit) : rows;

  const transactions: EarningsTransaction[] = page.map((row) => {
    const kind = classifyLedgerEntry(row.entryKind, row.reference);
    const amountCents = num(row.amount);
    const feeCents = kind === 'sale' ? (feeByOrder.get(row.reference ?? '') ?? 0) : 0;
    return {
      id: Number(row.id),
      occurredAtISO: row.occurredAt.toISOString(),
      kind,
      amountCents,
      feeCents,
      grossCents: amountCents + feeCents,
      reference: row.reference,
      memo: row.memo,
      tenantId: Number(row.tenantId),
      workspaceName: row.workspaceName ?? null,
    };
  });

  const feeByPeriod = new Map(feeBuckets.map((row) => [row.period, num(row.fee)]));
  const buckets: EarningsBucket[] = ledgerBuckets.map((row) => {
    const bucketNet = num(row.net);
    const bucketFee = feeByPeriod.get(row.period) ?? 0;
    feeByPeriod.delete(row.period);
    return { period: row.period, netCents: bucketNet, feeCents: bucketFee, grossCents: bucketNet + bucketFee, count: num(row.count) };
  });
  // A period with a fee and no ledger movement is a real (if odd) state — a sale whose
  // seller credit landed outside the range. Appending it beats silently dropping money.
  for (const [period, feeCents] of feeByPeriod) {
    buckets.push({ period, netCents: 0, feeCents, grossCents: feeCents, count: 0 });
  }
  buckets.sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0));

  return {
    scope: query.tenantId == null ? 'everywhere' : 'workspace',
    currency: 'USD',
    fromISO: query.from.toISOString(),
    toISO: query.to.toISOString(),
    period: query.period,
    summary: {
      grossCents: netCents + platformFeeCents,
      platformFeeCents,
      netCents,
      withdrawnCents,
      refundedCents: num(totalRow?.refunded),
      heldCents: held,
      availableCents: Math.max(0, netCents - withdrawnCents),
      transactionCount: num(totalRow?.count),
    },
    buckets,
    transactions,
    transactionsTruncated: truncated,
    fee,
    settlement: settlementMode(env),
  };
}

// ---------------------------------------------------------------------------
// The fee half — attributed through the stamped order line
// ---------------------------------------------------------------------------

/**
 * The order-line scope.
 *
 * `seller_ref` is the attribution the ledger's `partner/platform` fee row cannot carry.
 * Dated by the ORDER rather than the line, because the line has no independent life —
 * it is created in the same statement as its order.
 */
function orderLineScope(tenantId: number | null, userId: string, from: Date, to: Date): SQL {
  const subject = and(
    eq(orderLineItems.sellerRef, userId),
    gte(orders.createdAt, from),
    lt(orders.createdAt, to),
  );
  return tenantId == null
    ? acrossTenants(orderLineItems, 'subject_own_rows', subject)
    : scopedToTenant(orderLineItems, tenantId, subject);
}

async function feeTotalQuery(db: Db, query: EarningsQuery): Promise<string> {
  const [row] = await db
    .select({ fee: sql<string>`coalesce(sum(${orderLineItems.commissionCents}), 0)` })
    .from(orderLineItems)
    .innerJoin(orders, eq(orders.id, orderLineItems.orderId))
    .where(orderLineScope(query.tenantId, query.userId, query.from, query.to));
  return row?.fee ?? '0';
}

async function feeBucketQuery(
  db: Db,
  query: EarningsQuery,
): Promise<{ period: string; fee: string }[]> {
  const label = periodLabel(query.period, sql`${orders.createdAt}`);
  return db
    .select({ period: label, fee: sql<string>`coalesce(sum(${orderLineItems.commissionCents}), 0)` })
    .from(orderLineItems)
    .innerJoin(orders, eq(orders.id, orderLineItems.orderId))
    .where(orderLineScope(query.tenantId, query.userId, query.from, query.to))
    .groupBy(label)
    .orderBy(label);
}

/** `mp-sale:<orderId>` — the reference `creditSeller` mints for a seller's credit. */
const SALE_REFERENCE_PREFIX = 'mp-sale:';

/**
 * The fee on each LISTED movement, in one query rather than one per row.
 *
 * Only the page's own sale references are looked up, so the query is bounded by the
 * page size — the N+1 the performance rule names by name, avoided by construction.
 */
async function feesForListedOrders(
  db: Db,
  query: EarningsQuery,
  references: readonly (string | null)[],
): Promise<Map<string, number>> {
  const byOrderId = new Map<number, string>();
  for (const reference of references) {
    if (!reference?.startsWith(SALE_REFERENCE_PREFIX)) continue;
    const orderId = Number(reference.slice(SALE_REFERENCE_PREFIX.length));
    if (Number.isInteger(orderId) && orderId > 0) byOrderId.set(orderId, reference);
  }
  if (byOrderId.size === 0) return new Map();

  const ids = [...byOrderId.keys()];
  const subject = and(
    eq(orderLineItems.sellerRef, query.userId),
    sql`${orderLineItems.orderId} = any(${ids})`,
  );
  const rows = await db
    .select({ orderId: orderLineItems.orderId, commission: orderLineItems.commissionCents })
    .from(orderLineItems)
    .where(query.tenantId == null
      ? acrossTenants(orderLineItems, 'subject_own_rows', subject)
      : scopedToTenant(orderLineItems, query.tenantId, subject));

  const byReference = new Map<string, number>();
  for (const row of rows) {
    const reference = row.orderId == null ? undefined : byOrderId.get(Number(row.orderId));
    if (!reference) continue;
    byReference.set(reference, (byReference.get(reference) ?? 0) + num(row.commission));
  }
  return byReference;
}

// ---------------------------------------------------------------------------
// Escrow still held
// ---------------------------------------------------------------------------

/** The statuses in which the platform is holding a milestone's money, taken FROM the
 *  escrow machine rather than restated — `isHoldingFunds` is the one definition, and a
 *  second list here would be the one that forgot `approved`. */
const HOLDING_STATUSES: readonly string[] = MILESTONE_STATUSES.filter(isHoldingFunds);

/**
 * What is funded but not yet released for this person, right now.
 *
 * One indexed SUM over `idx_engagement_milestones_freelancer`, never a fetch-and-add.
 * A freelancer reading their earnings is asking two questions at once — "what have I
 * been paid" and "what is waiting" — and a report that answers only the first reads as
 * though the held money does not exist.
 */
async function heldCentsFor(db: Db, tenantId: number | null, userId: string): Promise<number> {
  const subject = and(
    eq(engagementMilestones.freelancerUserId, userId),
    sql`${engagementMilestones.status} = any(${HOLDING_STATUSES})`,
  );
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${engagementMilestones.amountCents}), 0)` })
    .from(engagementMilestones)
    .where(tenantId == null
      ? acrossTenants(engagementMilestones, 'subject_own_rows', subject)
      : scopedToTenant(engagementMilestones, tenantId, subject));
  return num(row?.total);
}

// ---------------------------------------------------------------------------
// Default range
// ---------------------------------------------------------------------------

/**
 * The window a report defaults to when the caller names none: the last twelve months,
 * ending at the top of tomorrow so today's movements are inside it.
 *
 * Twelve months rather than "all time" because the default has to be a bounded scan;
 * a caller who wants everything says so with explicit dates.
 */
export function defaultEarningsRange(now = new Date()): { from: Date; to: Date } {
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const from = new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), now.getUTCDate() + 1));
  return { from, to };
}

/** A date off the query string, or the fallback. Refuses anything that is not a real
 *  date rather than letting `Invalid Date` reach a SQL parameter. */
export function parseRangeDate(raw: unknown, fallback: Date): Date {
  if (typeof raw !== 'string' || raw.trim() === '') return fallback;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}
