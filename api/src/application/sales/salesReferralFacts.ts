/**
 * The referral facts, keyed by ATTRIBUTION — the one read every sales figure is made of.
 *
 * ── WHY ATTRIBUTION, NOT WORKSPACE ───────────────────────────────────────────
 * A referral is recorded against the workspace it converts in (`sales_referrals.tenant_id`),
 * but it is ATTRIBUTED to a person: `sales_referrals.associate_user_id`, the account whose
 * referral or sales code the signup used. An associate signs in with the person-level web
 * token, which names no workspace — and even if it did, one workspace is the wrong
 * population: an associate who referred into five workspaces is owed on all five, and a
 * signup that has not reached checkout yet has NO workspace at all (`tenant_id` is only
 * bound at checkout). So an associate's figures are keyed by their own user id — the
 * column the rows already use to name them — and span every workspace (operator decision
 * 2026-09-12).
 *
 * That is `acrossTenants(…, 'subject_own_rows', …)` and not a leak, because the access
 * predicate is the attribution itself: `associate_user_id = <this associate>` returns
 * strictly fewer rows than any tenant filter would, and never a row that names somebody
 * else. WHO may ask for a given associate is decided upstream by
 * `SalesWorkspaceService.owner` (yourself, or a superadmin opening a sales associate).
 *
 * Three populations, one loader:
 *   • `{ tenantId: n }`                 — ONE workspace (with or without an associate).
 *                                         Read live, exactly as before this change.
 *   • `{ tenantId: null, associate }`   — one associate, every workspace. Cached.
 *   • `{ tenantId: null, associate: null }` — the programme (superadmin aggregate),
 *                                         every associate in every workspace. Cached.
 *
 * ── WHAT THE PROJECTION CARRIES ─────────────────────────────────────────────
 * Only the referral's own economics. No workspace id, no workspace name, no referred
 * person: the report never exposed the referred workspace, and a cross-workspace view
 * must not start. (It also means the checkout-binding write in `tenantRoutes`, which
 * only moves `tenant_id`, changes nothing this projection holds.)
 *
 * ── CACHE ────────────────────────────────────────────────────────────────────
 * Read-through under a VERSION token per associate (plus one for the programme): every
 * referral write — signup, verification, OAuth claim, conversion — bumps the token of the
 * associate it is attributed to AND the programme token, orphaning every cached read at
 * once. The TTL is a backstop, not the mechanism.
 */

import { desc, eq, isNotNull } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { salesReferrals } from '../../infrastructure/database/schema';
import { acrossTenants, scopedToTenant } from '../../infrastructure/database/tenantScope';
import { bumpCacheVersion, getCacheVersion, getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { reportCaughtError } from '../observability/caughtErrorReporter';

/** Whose referrals, and in which workspace. `tenantId` null = every workspace;
 *  `associateUserId` null = every associate. */
export interface SalesReferralScope {
  tenantId: number | null;
  associateUserId: string | null;
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

/** One referral row, as every sales read needs it. */
export interface ReferralRecord extends ReferralFact {
  id: string;
  plan: string | null;
  /** Verified signup — the report counts only these; the lead list shows every row. */
  signupNotified: boolean;
}

/** One lead, as the hub's lead list renders it. */
export interface SalesLeadRecord {
  id: string;
  attributionType: string;
  signedUpAt: Date;
  convertedAt: Date | null;
  plan: string | null;
  revenueCents: number | null;
  commissionCents: number | null;
}

/** The cached shape: the L2 layer is JSON, so dates travel as ISO strings. */
interface StoredReferralRecord extends Omit<ReferralRecord, 'signedUpAt' | 'convertedAt'> {
  signedUpAtISO: string;
  convertedAtISO: string | null;
}

const toStored = ({ signedUpAt, convertedAt, ...rest }: ReferralRecord): StoredReferralRecord => ({
  ...rest,
  signedUpAtISO: signedUpAt.toISOString(),
  convertedAtISO: convertedAt ? convertedAt.toISOString() : null,
});

const fromStored = ({ signedUpAtISO, convertedAtISO, ...rest }: StoredReferralRecord): ReferralRecord => ({
  ...rest,
  signedUpAt: new Date(signedUpAtISO),
  convertedAt: convertedAtISO ? new Date(convertedAtISO) : null,
});

/**
 * The one referral read. Uncached — see {@link readReferralRecords} for the cached entry.
 *
 * The predicate is built INLINE so the tenant-scope guard reads the scope at the
 * statement: a workspace view is `scopedToTenant`; an attributed view is the associate's
 * own rows; the programme view is every verified signup.
 */
export async function loadReferralRecords(db: Db, scope: SalesReferralScope): Promise<ReferralRecord[]> {
  const associate = scope.associateUserId ? eq(salesReferrals.associateUserId, scope.associateUserId) : undefined;
  const rows = await db.select({
    id: salesReferrals.id,
    associateUserId: salesReferrals.associateUserId,
    attributionType: salesReferrals.attributionType,
    signedUpAt: salesReferrals.signedUpAt,
    signupNotifiedAt: salesReferrals.signupNotifiedAt,
    convertedAt: salesReferrals.convertedAt,
    plan: salesReferrals.plan,
    revenueCents: salesReferrals.revenueCents,
    commissionCents: salesReferrals.commissionCents,
  }).from(salesReferrals)
    .where(scope.tenantId != null
      ? scopedToTenant(salesReferrals, scope.tenantId, associate)
      : associate
        ? acrossTenants(salesReferrals, 'subject_own_rows', associate)
        // The programme feeds only the report, which counts only verified signups.
        : acrossTenants(salesReferrals, 'platform_aggregate', isNotNull(salesReferrals.signupNotifiedAt)))
    .orderBy(desc(salesReferrals.signedUpAt));

  return rows.map((row) => ({
    id: row.id,
    associateUserId: row.associateUserId,
    attributionType: row.attributionType,
    signedUpAt: row.signedUpAt,
    convertedAt: row.convertedAt,
    signupNotified: row.signupNotifiedAt != null,
    plan: row.plan,
    revenueCents: row.revenueCents,
    commissionCents: row.commissionCents,
  }));
}

/** The version token one associate's cached reads embed. Keyed by the associate's own
 *  user id — the attribution key — never by a workspace. */
export const salesAssociateVersionKey = (associateUserId: string): string =>
  `sales:referrals:associate:${associateUserId}`;

/** The version token the programme-wide (superadmin) read embeds. */
export const SALES_PROGRAMME_VERSION_KEY = 'sales:referrals:programme';

const REFERRAL_CACHE_TTL = { kvTtlSeconds: 300, l1TtlMs: 15_000 };

/**
 * The referral records for a scope — read-through cached for the cross-workspace views.
 *
 * The workspace view is read live, as it always was: it is not what the hub reads, and
 * caching it would add a per-tenant key every write would then have to find.
 */
export async function readReferralRecords(db: Db, env: Env | undefined, scope: SalesReferralScope): Promise<ReferralRecord[]> {
  if (scope.tenantId != null || !env) return loadReferralRecords(db, scope);
  const versionKey = scope.associateUserId ? salesAssociateVersionKey(scope.associateUserId) : SALES_PROGRAMME_VERSION_KEY;
  const version = await getCacheVersion(env, versionKey);
  const key = `sales:referrals:v1:${scope.associateUserId ? `a:${scope.associateUserId}` : 'programme'}:v:${version}`;
  const stored = await getOrSetCached(
    env,
    key,
    async () => (await loadReferralRecords(db, scope)).map(toStored),
    REFERRAL_CACHE_TTL,
  );
  return stored.map(fromStored);
}

/**
 * Orphan every cached read for the associate a referral is attributed to, and the
 * programme roll-up that sums them. Call from EVERY referral / commission write.
 * Best-effort: a cache bump must never fail the signup or the webhook it rides on.
 */
export async function invalidateSalesReferrals(env: Env | undefined, associateUserId: string): Promise<void> {
  if (!env) return;
  await Promise.all([
    bumpCacheVersion(env, salesAssociateVersionKey(associateUserId)),
    bumpCacheVersion(env, SALES_PROGRAMME_VERSION_KEY),
  ]).catch((error) => {
    reportCaughtError(error, { source: 'application/sales/salesReferralFacts.ts', operation: 'invalidateSalesReferrals' });
  });
}

// ---------------------------------------------------------------------------
// Readings of one record set — pure, so each definition is testable without a database
// ---------------------------------------------------------------------------

/** The report's population: verified signups only. */
export function reportFacts(records: readonly ReferralRecord[]): ReferralFact[] {
  return records.filter((record) => record.signupNotified).map((record) => ({
    associateUserId: record.associateUserId,
    attributionType: record.attributionType,
    signedUpAt: record.signedUpAt,
    convertedAt: record.convertedAt,
    revenueCents: record.revenueCents,
    commissionCents: record.commissionCents,
  }));
}

/** Leads that signed up since `from`, newest first — the hub's "current leads". */
export function leadsSince(records: readonly ReferralRecord[], from: Date): SalesLeadRecord[] {
  return records
    .filter((record) => record.signedUpAt.getTime() >= from.getTime())
    .sort((a, b) => b.signedUpAt.getTime() - a.signedUpAt.getTime())
    .map((record) => ({
      id: record.id,
      attributionType: record.attributionType,
      signedUpAt: record.signedUpAt,
      convertedAt: record.convertedAt,
      plan: record.plan,
      revenueCents: record.revenueCents,
      commissionCents: record.commissionCents,
    }));
}

/** Commission EARNED to date — converted referrals. The one definition of "earned"
 *  the payout balance subtracts from. */
export function earnedCents(records: readonly ReferralRecord[]): number {
  return records.reduce((sum, record) => sum + (record.convertedAt ? (record.commissionCents ?? 0) : 0), 0);
}
