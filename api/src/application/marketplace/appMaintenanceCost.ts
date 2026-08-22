/**
 * WHAT A HOSTED APP'S AGENT RUNS COST, CHARGED AGAINST ITS OWN EARNINGS.
 *
 * ── THE PROBLEM THIS CLOSES ───────────────────────────────────────────────────
 * A hosted listing is a `catalog_items` row published from a board that a
 * `creation_session_project_links` row of kind `app` says IS a project (0473) —
 * see `ListingTarget.projectId` in `creationListings.ts`. Once the project IS the
 * app, agents keep maintaining it after the sale, and every one of those runs is
 * now OUR compute, not a cloud bill the creator absorbs ("no self-hosting"). But
 * nothing connected what those runs cost to what the app earns: the per-tenant
 * dispatch caps, the autorun circuit-breaker (`evaluateAutoRun.ts`) and
 * `MARKETPLACE_TAKE_RATE_BPS` are three independent controls that have never
 * heard of each other, so a thriving app's creator could be rate-limited by a
 * cap that has never heard of their earnings while the platform's 15% cut of a
 * sale is booked in a different subsystem than the maintenance it funds.
 *
 * ── THE MODEL: MAINTENANCE COMES OUT OF THE PAYOUT ────────────────────────────
 * Decided over the alternatives (creator's plan — doesn't scale with what the
 * app earns, a thriving app still trips the same tenant-wide cap as a dead one;
 * a dedicated prepaid compute budget — a second meter): every dollar
 * `llm_usage_log` already attributes to the app's project (0103) is debited from
 * the SAME `ledger_entries` account the seller is paid from, as one more
 * `entryKind` alongside `commission` / `refund` / `payout`. A hosted app pays for
 * its own upkeep out of its own sales, and `PayoutAccountService.balance` already
 * floors `availableCents` at zero, so a payout can never exceed sales minus the
 * compute that earned them.
 *
 * No new meter: `sumProjectAgentCostCents` reads the SAME `llm_usage_log.projectId`
 * attribution the token/spend caps already stamp on every run — this module adds
 * no usage-tracking table, only a debit against the existing ledger.
 */

import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import {
  catalogItems,
  creationSessionProjectLinks,
  ledgerEntries,
  llmUsageLog,
  SESSION_PROJECT_LINK_APP,
} from '../../infrastructure/database/schema';
import { USD_CENTS } from '../kernel/denominations';


/** The `ledger_entries.entryKind` this module writes and reads — alongside
 *  'commission' / 'refund' / 'payout', an app-upkeep debit against the same
 *  seller account. */
const MAINTENANCE_COST_ENTRY_KIND = 'maintenance_cost';

/**
 * The project a hosted listing IS, resolved the same way `resolveListingTarget`
 * resolved it at publish time (0473): via the `app` link on the session the
 * listing's `body.source.sessionId` names. Null for a `copy` listing, or a
 * `hosted` listing whose board was never converted into an app.
 */
async function hostedListingProjectId(db: Db, catalogItemId: string, tenantId: number): Promise<number | null> {
  const [row] = await db
    .select({ projectId: creationSessionProjectLinks.projectId })
    .from(catalogItems)
    .innerJoin(creationSessionProjectLinks, and(
      eq(
        creationSessionProjectLinks.sessionId,
        sql<string>`(${catalogItems.body}->'source'->>'sessionId')::uuid`,
      ),
      eq(creationSessionProjectLinks.linkKind, SESSION_PROJECT_LINK_APP),
    ))
    .where(and(eq(catalogItems.id, catalogItemId), eq(catalogItems.tenantId, tenantId)))
    .limit(1);
  return row?.projectId ?? null;
}

/** Every dollar `llm_usage_log` has attributed to this project, ever — the SAME
 *  attribution the token caps already stamp on every run (0103), summed with the
 *  index that rollup was built for rather than re-read row by row. */
async function sumProjectAgentCostCents(db: Db, tenantId: number, projectId: number): Promise<number> {
  const [row] = await db
    .select({ totalMillicents: sql<string>`coalesce(sum(${llmUsageLog.costUsdMillicents}), 0)` })
    .from(llmUsageLog)
    .where(and(eq(llmUsageLog.tenantId, tenantId), eq(llmUsageLog.projectId, projectId)));
  // costUsdMillicents is 1/100000 USD (0097); 1000 of them make one cent.
  return Math.round(Number(row?.totalMillicents ?? 0) / 1000);
}

/** What has already been charged against this seller for this one app — so
 *  charging stays idempotent and only ever debits the DELTA since last time. */
async function alreadyChargedCents(db: Db, tenantId: number, sellerRef: string, catalogItemId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(abs(${ledgerEntries.amount})), 0)` })
    .from(ledgerEntries)
    .where(and(
      eq(ledgerEntries.tenantId, tenantId),
      eq(ledgerEntries.accountKind, 'user'),
      eq(ledgerEntries.accountRef, sellerRef),
      eq(ledgerEntries.denomination, USD_CENTS),
      eq(ledgerEntries.entryKind, MAINTENANCE_COST_ENTRY_KIND),
      sql`${ledgerEntries.metadata}->>'catalogItemId' = ${catalogItemId}`,
    ));
  return Math.round(Number(row?.total ?? 0));
}

/**
 * Bring one listing's maintenance charge up to date: debit the seller for
 * whatever `llm_usage_log` cost has accrued against its project since the last
 * charge. A no-op for anything that isn't a hosted app tied to a project.
 *
 * Idempotent by construction — `reference` is derived from the cumulative
 * accrued total, which only ever grows, so two callers racing to charge the
 * same accrual collide on the same reference and the second is refused by the
 * database, exactly like a marketplace sale (`creditSeller`).
 */
export async function chargeAppMaintenanceCost(
  db: Db,
  catalogItemId: string,
  tenantId: number,
  sellerRef: string,
  listingName: string,
): Promise<void> {
  const projectId = await hostedListingProjectId(db, catalogItemId, tenantId);
  if (projectId == null) return;

  const [accruedCents, chargedCents] = await Promise.all([
    sumProjectAgentCostCents(db, tenantId, projectId),
    alreadyChargedCents(db, tenantId, sellerRef, catalogItemId),
  ]);
  const deltaCents = accruedCents - chargedCents;
  if (deltaCents <= 0) return;

  await db.insert(ledgerEntries).values({
    tenantId,
    accountKind: 'user',
    accountRef: sellerRef,
    denomination: USD_CENTS,
    amount: String(-deltaCents),
    entryKind: MAINTENANCE_COST_ENTRY_KIND,
    reference: `mp-maint:${catalogItemId}:${accruedCents}`,
    memo: `Hosted app maintenance — ${listingName}`,
    metadata: { source: 'app_maintenance', catalogItemId, projectId, accruedCents },
  }).onConflictDoNothing();
}

/**
 * Bring every listing this seller publishes in this tenant up to date. Cheap to
 * call on every earnings/payout read: a listing with no project link (not an
 * app) or with nothing new to charge resolves in one indexed lookup and returns.
 */
export async function chargeAllHostedAppMaintenance(db: Db, tenantId: number, sellerRef: string): Promise<void> {
  const listings = await db
    .select({ id: catalogItems.id, name: catalogItems.name })
    .from(catalogItems)
    .where(and(eq(catalogItems.tenantId, tenantId), eq(catalogItems.publisherRef, sellerRef)));
  await Promise.all(listings.map((listing) =>
    chargeAppMaintenanceCost(db, listing.id, tenantId, sellerRef, listing.name)));
}

/**
 * What this seller's hosted apps have cost them, ever — the debit side that
 * nets against `lifetimeSellerCents` (gross commission) to produce what is
 * actually available to pay out.
 *
 * Kept OUT of `lifetimeSellerCents` itself: the take-rate threshold is a fact
 * about gross sales, and netting maintenance cost into it would let a
 * heavily-hosted app's own upkeep quietly reset its progress toward the fee
 * threshold — two different questions that must not share one number.
 */
export async function sellerMaintenanceCostCents(db: Db, tenantId: number, sellerRef: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(abs(${ledgerEntries.amount})), 0)` })
    .from(ledgerEntries)
    .where(and(
      eq(ledgerEntries.tenantId, tenantId),
      eq(ledgerEntries.accountKind, 'user'),
      eq(ledgerEntries.accountRef, sellerRef),
      eq(ledgerEntries.denomination, USD_CENTS),
      eq(ledgerEntries.entryKind, MAINTENANCE_COST_ENTRY_KIND),
    ));
  return Math.round(Number(row?.total ?? 0));
}
