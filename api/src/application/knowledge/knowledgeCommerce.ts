/**
 * BUYING A KNOWLEDGE LISTING — the paid half of the knowledge marketplace.
 *
 * A priced listing used to be unbuyable: `POST /listings/:id/checkout` answered
 * `{ requiresConfig: true }`, recorded nothing, and `/install` therefore 402'd
 * forever. The listing could be published and priced, and no one could pay for it.
 * That is history — the flow below is live, and Stripe is the only processor
 * behind it (`buildPaymentProvider` has no `manual` branch to fall back to; an
 * unconfigured deploy raises, it does not grant).
 *
 * ── ONE PAYMENT MACHINE, NOT A SECOND ONE ────────────────────────────────────
 * The processor round-trip is `finance/verifiedCheckout`, the same primitive the
 * creation-listing sale, the tenant invoice and the hosted-app subscription go
 * through. This module contributes what is genuinely its own — which listing, who
 * may buy it, and what a purchase entitles them to — and nothing about payments.
 * The alternative was a fourth hand-written copy of "is it paid, is it for this,
 * is it yours", including the ownership check that is the whole security of the
 * flow.
 *
 * ── NOTHING IS GRANTED BEFORE THE PROCESSOR SAYS SO ──────────────────────────
 * `startKnowledgeCheckout` mints an invitation to pay and records nothing.
 * `completeKnowledgeCheckout` re-reads the session FROM the processor and only
 * then writes the purchase row. The unique index on
 * `(listing_id, tenant_id)` makes a replayed redirect land on the row that is
 * already there rather than on a second charge.
 *
 * ── THE SELLER GETS PAID ─────────────────────────────────────────────────────
 * A sale credits the seller's workspace and the platform's cut as two
 * `ledger_entries` rows in ONE insert, keyed on the purchase so a retry collides
 * in the database. This is the same shape `listingCommerce.creditSeller` uses, and
 * it is deliberately not shared with it: that function is bound to an `orders`
 * row this flow does not create, and widening it to take either would be a bigger
 * seam than the eight lines it would save.
 */

import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  knowledgeListingPurchases,
  ledgerEntries,
  marketplaceKnowledge,
} from '../../infrastructure/database/schema';
import { acrossTenants, scopedToTenant } from '../../infrastructure/database/tenantScope';
import { buildPaymentProvider } from '../../infrastructure/payment';
import { ListingError } from '../marketplace/creationListings';
import { platformTakeRateBps, lifetimeSellerCents, takeRateThresholdCents } from '../marketplace/listingCommerce';
import { verifyPaidCheckout, assertCovers } from '../finance/verifiedCheckout';

const USD_CENTS = 'usd_cents';

/** What this flow calls itself in checkout metadata. */
export const KNOWLEDGE_PURCHASE_KIND = 'knowledge_listing';

const refuse = (message: string, status: 400 | 403 | 404) => new ListingError(message, status);

export interface KnowledgePurchase {
  purchaseId: string;
  listingId: string;
  priceCents: number;
  /** Zero while the seller is under the lifetime threshold. */
  commissionCents: number;
  sellerCents: number;
}

/**
 * The listing a buyer is asking about.
 *
 * CROSS-TENANT BY DESIGN, and declared as such: a public listing is bought FROM
 * another workspace, so filtering by the buyer's tenant would make every listing
 * on the market invisible to everyone who might pay for it. `visibility` is the
 * access predicate that replaces the tenant one.
 */
async function loadPurchasableListing(db: Db, listingId: string) {
  const [listing] = await db
    .select()
    .from(marketplaceKnowledge)
    .where(acrossTenants(marketplaceKnowledge, 'public_catalogue',
      eq(marketplaceKnowledge.id, listingId), eq(marketplaceKnowledge.visibility, 'public')))
    .limit(1);
  return listing ?? null;
}

/** Has this workspace already bought it? The gate `/install` reads. */
export async function holdsKnowledgePurchase(
  db: Db,
  tenantId: number,
  listingId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: knowledgeListingPurchases.id })
    .from(knowledgeListingPurchases)
    .where(scopedToTenant(knowledgeListingPurchases, tenantId,
      eq(knowledgeListingPurchases.listingId, listingId)))
    .limit(1);
  return Boolean(row);
}

/**
 * Send a buyer to the processor's hosted page for a priced knowledge listing.
 *
 * Grants nothing. Every refusal here is one that would otherwise become a charge
 * for something the buyer already has, cannot use, or published themselves.
 */
export async function startKnowledgeCheckout(
  db: Db,
  env: Env,
  input: { tenantId: number; buyerUserId: string; buyerEmail?: string | null; listingId: string; returnUrl: string },
): Promise<{ checkoutUrl: string }> {
  const listing = await loadPurchasableListing(db, input.listingId);
  if (!listing) throw new ListingError('Listing not found', 404);
  if (listing.priceCents <= 0) throw new ListingError('This listing is free — no checkout is needed', 400);
  if (listing.tenantId === input.tenantId) {
    throw new ListingError('You already own what you published', 400);
  }
  if (await holdsKnowledgePurchase(db, input.tenantId, listing.id)) {
    throw new ListingError('You already own this', 400);
  }
  if (!env.STRIPE_SECRET_KEY) {
    throw new ListingError('Payments are not configured on this deployment', 400);
  }

  const base = new URL(input.returnUrl);
  const session = await buildPaymentProvider(env).createOneTimeCheckoutSession({
    amountCents: listing.priceCents,
    currency: 'USD',
    productName: listing.title,
    billingEmail: input.buyerEmail ?? null,
    // Only the ORIGIN and PATH of the caller's url are kept, so a return url
    // cannot smuggle a query string back through the processor. The listing id is
    // re-attached here, from the row, because the buyer comes back needing to say
    // WHICH purchase to complete and the processor substitutes only the session id.
    successUrl: `${base.origin}${base.pathname}?checkout={CHECKOUT_SESSION_ID}&listing=${listing.id}`,
    cancelUrl: `${base.origin}${base.pathname}?checkout=cancelled`,
    metadata: {
      purchaseKind: KNOWLEDGE_PURCHASE_KIND,
      listingId: listing.id,
      buyerTenantId: String(input.tenantId),
      // Carried because the WEBHOOK leg has no session to read it from, and the
      // purchase row records who bought it. The redirect leg has both and agrees.
      buyerUserId: input.buyerUserId,
    },
    idempotencyKey: `kn-checkout:${listing.id}:${input.tenantId}`,
  });
  return { checkoutUrl: session.checkoutUrl };
}

/**
 * Finish a paid knowledge acquisition.
 *
 * The session id arrives from the buyer's address bar, so everything that
 * authorises the purchase is read back from the processor — including that the
 * workspace completing it is the workspace it was created for.
 */
export async function completeKnowledgeCheckout(
  db: Db,
  env: Env,
  input: { tenantId: number; buyerUserId: string; checkoutSessionId: string },
): Promise<KnowledgePurchase> {
  const verified = await verifyPaidCheckout(env, {
    checkoutSessionId: input.checkoutSessionId,
    purchaseKind: KNOWLEDGE_PURCHASE_KIND,
    owner: { buyerTenantId: input.tenantId },
    messages: {
      notConfigured: 'Payments are not configured on this deployment',
      notFound: 'That checkout could not be found',
      notPaid: 'That checkout has not been paid',
      wrongKind: 'That checkout was not for a knowledge listing',
      notYours: 'That checkout belongs to someone else',
    },
    refuse,
  });

  const listingId = verified.metadata.listingId;
  if (!listingId) throw new ListingError('That checkout names no listing', 400);
  const listing = await loadPurchasableListing(db, listingId);
  if (!listing) throw new ListingError('Listing not found', 404);
  // A buyer must not be able to open checkout at the old price and complete it
  // after the seller raised it.
  assertCovers(verified, listing.priceCents, 'The payment does not cover this listing', refuse);

  return recordKnowledgePurchase(db, env, {
    tenantId: input.tenantId,
    buyerUserId: input.buyerUserId,
    listing,
    priceCents: listing.priceCents,
    provider: 'stripe',
    externalRef: verified.paymentRef,
  });
}

/**
 * Write the purchase and pay the seller.
 *
 * `onConflictDoNothing` on `(listing_id, tenant_id)` is what makes a replayed
 * redirect idempotent, and the re-read after it is what lets this still return the
 * purchase rather than nothing when the replay loses that race.
 */
async function recordKnowledgePurchase(
  db: Db,
  env: Env,
  input: {
    tenantId: number;
    buyerUserId: string;
    listing: { id: string; title: string; tenantId: number; createdBy: string | null };
    priceCents: number;
    provider: string;
    externalRef: string | null;
  },
): Promise<KnowledgePurchase> {
  const [inserted] = await db
    .insert(knowledgeListingPurchases)
    .values({
      listingId: input.listing.id,
      tenantId: input.tenantId,
      purchasedBy: input.buyerUserId,
      priceCents: input.priceCents,
      provider: input.provider,
      externalRef: input.externalRef,
    })
    .onConflictDoNothing()
    .returning({ id: knowledgeListingPurchases.id });

  let purchaseId = inserted?.id ?? null;
  if (!purchaseId) {
    const [existing] = await db
      .select({ id: knowledgeListingPurchases.id })
      .from(knowledgeListingPurchases)
      .where(scopedToTenant(knowledgeListingPurchases, input.tenantId,
        eq(knowledgeListingPurchases.listingId, input.listing.id)))
      .limit(1);
    purchaseId = existing?.id ?? null;
  }
  if (!purchaseId) throw new ListingError('Could not record the purchase', 400);

  const { commissionCents, sellerCents } = await splitKnowledgeSale(db, env, input.listing, input.priceCents);
  // Only a sale with an identifiable seller ACCOUNT can be credited; a listing
  // whose author row is gone still transfers, it just has nobody to pay.
  if (input.priceCents > 0 && input.listing.createdBy) {
    await creditKnowledgeSeller(db, {
      sellerTenantId: input.listing.tenantId,
      sellerRef: input.listing.createdBy,
      purchaseId,
      listingTitle: input.listing.title,
      sellerCents,
      commissionCents,
    });
  }

  return { purchaseId, listingId: input.listing.id, priceCents: input.priceCents, commissionCents, sellerCents };
}

/**
 * The platform's cut of this sale.
 *
 * Reuses the marketplace's own threshold rule rather than restating a rate, so a
 * seller who is under the lifetime threshold pays nothing on knowledge exactly as
 * they pay nothing on a creation. Two rate rules on one platform is how a seller
 * gets charged differently depending on which page they published from.
 */
async function splitKnowledgeSale(
  db: Db,
  env: Env,
  listing: { tenantId: number; createdBy: string | null },
  priceCents: number,
): Promise<{ commissionCents: number; sellerCents: number }> {
  if (priceCents <= 0 || !listing.createdBy) return { commissionCents: 0, sellerCents: priceCents };
  const { earnedCents } = await lifetimeSellerCents(db, listing.tenantId, listing.createdBy);
  const underThreshold = earnedCents < takeRateThresholdCents(env);
  const bps = underThreshold ? 0 : platformTakeRateBps(env);
  const commissionCents = Math.round((priceCents * bps) / 10_000);
  return { commissionCents, sellerCents: priceCents - commissionCents };
}

/**
 * The two ledger rows a sale produces, as ONE insert.
 *
 * THE TENANT ON THESE ROWS IS THE SELLER'S, NOT THE BUYER'S — the earning has to
 * land in the books it will be paid out of. Both references derive from the
 * purchase, so the unique index on `reference` refuses a replayed pair whole.
 */
async function creditKnowledgeSeller(db: Db, input: {
  sellerTenantId: number;
  sellerRef: string;
  purchaseId: string;
  listingTitle: string;
  sellerCents: number;
  commissionCents: number;
}): Promise<void> {
  await db.insert(ledgerEntries).values([
    {
      tenantId: input.sellerTenantId,
      accountKind: 'user',
      accountRef: input.sellerRef,
      denomination: USD_CENTS,
      amount: String(input.sellerCents),
      entryKind: 'commission',
      reference: `kn-sale:${input.purchaseId}`,
      memo: `Knowledge sale — ${input.listingTitle}`,
      metadata: { source: 'knowledge_listing', purchaseId: input.purchaseId },
    },
    {
      tenantId: input.sellerTenantId,
      accountKind: 'partner',
      accountRef: 'platform',
      denomination: USD_CENTS,
      amount: String(input.commissionCents),
      entryKind: 'commission',
      reference: `kn-fee:${input.purchaseId}`,
      memo: `Platform fee — ${input.listingTitle}`,
      metadata: { source: 'knowledge_listing', purchaseId: input.purchaseId },
    },
  ]).onConflictDoNothing();
}
