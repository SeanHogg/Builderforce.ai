/**
 * BUYING A CANVAS CREATION, AND PAYING THE PERSON WHO BUILT IT.
 *
 * ── FOUR ROWS, AND WHY THE MONEY IS NOT ONE OF THEM ──────────────────────────────
 * A sale writes an `orders` row (the agreement), an `order_line_items` row (what was
 * bought, from whom, at what commission), a `template_licenses` row (the buyer's
 * standing right to use it) and TWO `ledger_entries` (the seller's earning and the
 * platform's cut). The order is not the money and the licence is not the money —
 * that separation is what lets a refund reverse the cash without deleting the record
 * that a sale happened, and lets a licence survive the seller withdrawing the listing.
 *
 * ── THE INVARIANT THAT MATTERS MOST: ONE REFERENCE, ONE CHARGE ───────────────────
 * `ledger_entries` has a unique index on `(tenant, denomination, reference)`. Every
 * entry written here derives its reference from the ORDER, so a retried request, a
 * double-clicked button and a replayed webhook all collide on the same key and the
 * second one is refused by the database rather than by a check someone remembered to
 * write. Money movement is the one place where "probably not twice" is not good
 * enough.
 *
 * ── THE PAID PATH HAS EXACTLY ONE DOOR ───────────────────────────────────────────
 * `acquireListing` grants FREE listings and cannot grant anything else. A priced
 * one goes `startListingCheckout` → the processor's hosted page →
 * `completeListingCheckout`, which re-reads the session FROM the processor before
 * anything is granted. The reason is the shape of the alternative: an endpoint
 * that accepts a payment id from the request body hands paid products to anyone
 * who posts a plausible string, and it looks exactly like a working integration
 * while it does so.
 *
 * Payment itself goes through the `PaymentProvider` PORT, so this module names no
 * vendor and the platform keeps one payment integration rather than two.
 */

import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  catalogItems,
  ledgerEntries,
  orderLineItems,
  orders,
  templateLicenses,
} from '../../infrastructure/database/schema';
import { verifyJwt } from '../../infrastructure/auth/JwtService';
import { buildPaymentProvider } from '../../infrastructure/payment';
import { acrossTenants } from '../../infrastructure/database/tenantScope';
import { registerObject } from '../kernel/ObjectRegistry';
import { fireEventTriggers } from '../workflow/eventTriggers';
import { PayoutAccountService } from '../payouts/PayoutAccountService';
import { verifyPaidCheckout } from '../finance/verifiedCheckout';
import { ListingError, invalidateListingCaches, recordInstall } from './creationListings';
import { chargeAllHostedAppMaintenance, sellerMaintenanceCostCents } from './appMaintenanceCost';

const USD_CENTS = 'usd_cents';

/** The platform's cut ONCE A SELLER IS PAST THE THRESHOLD. 15%, overridable. */
const DEFAULT_TAKE_RATE_BPS = 1500;

/**
 * Lifetime earnings a seller must pass before the platform takes anything.
 * $200,000 by default — the monday.com shape, and the same order of magnitude
 * Square and Atlassian use.
 */
const DEFAULT_TAKE_RATE_THRESHOLD_CENTS = 20_000_000;

/**
 * The configured rate for sellers who are past the threshold.
 *
 * Clamped to 0–5000 bps: a misconfigured env var that reads `"50%"` must not become
 * a 5000% commission that inverts the seller's earning into a debt. A rate outside
 * the band is a typo, and the safe reading of a typo is the default.
 */
export function platformTakeRateBps(env: Env): number {
  const raw = wholeNumberOrNull(env.MARKETPLACE_TAKE_RATE_BPS);
  if (raw === null || raw < 0 || raw > 5000) return DEFAULT_TAKE_RATE_BPS;
  return raw;
}

/** The lifetime total a seller must cross before any fee applies. */
export function takeRateThresholdCents(env: Env): number {
  const raw = wholeNumberOrNull(env.MARKETPLACE_TAKE_RATE_THRESHOLD_CENTS);
  if (raw === null || raw < 0) return DEFAULT_TAKE_RATE_THRESHOLD_CENTS;
  return raw;
}

/**
 * A configured integer, or null when the value is not one.
 *
 * `Number.parseInt` is the wrong tool for reading configuration and this is the
 * bug it caused: `parseInt('50%', 10)` is `50`, not NaN, so an operator who
 * typed "50%" meaning half got 50 basis points — 0.5% — and the range clamp
 * above waved it through because 50 is a legal rate. The failure is silent and
 * the money is wrong by a factor of a hundred.
 *
 * Requiring the WHOLE string to be digits is the fix. A value that is not a
 * number is a typo, and the safe reading of a typo is the default.
 */
function wholeNumberOrNull(value: unknown): number | null {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * WHAT THIS SELLER HAS EARNED, EVER — net of refunds.
 *
 * ONE indexed SUM over the account index, never a fetch-and-add: a seller with
 * three thousand sales must not pull three thousand rows to price one checkout.
 * `commission` and `refund` are summed TOGETHER because a refund is written as a
 * negative entry — the balance IS the sum of the account, and a separate
 * subtraction would eventually disagree with it.
 *
 * Extracted so the take-rate resolver and the earnings page read the same
 * number. Two queries answering "what has this seller earned" is how the rate a
 * buyer is charged and the figure the seller is shown drift apart.
 *
 * `accountKind` DEFAULTS TO 'user' BECAUSE MOST SELLERS ARE PEOPLE — a creation,
 * a knowledge listing and a hosted site all name an author, and their earnings
 * accrue to that person's account. A marketplace AGENT names none (`ide_agents`
 * has no author column), so its earnings accrue to the publishing WORKSPACE.
 * The parameter exists so both read the same function: the threshold a seller is
 * measured against and the account the money lands in have to be the same
 * account, or a seller crosses the threshold in one query and never in the other
 * and is charged 0% forever.
 */
export type SellerAccountKind = 'user' | 'tenant';

export async function lifetimeSellerCents(
  db: Db,
  tenantId: number,
  accountRef: string,
  accountKind: SellerAccountKind = 'user',
): Promise<{ earnedCents: number; salesCount: number }> {
  const [row] = await db
    .select({
      total: sql<string>`coalesce(sum(${ledgerEntries.amount}), 0)`,
      sales: sql<string>`count(*) filter (where ${ledgerEntries.entryKind} = 'commission')`,
    })
    .from(ledgerEntries)
    .where(and(
      eq(ledgerEntries.tenantId, tenantId),
      eq(ledgerEntries.accountKind, accountKind),
      eq(ledgerEntries.accountRef, accountRef),
      eq(ledgerEntries.denomination, USD_CENTS),
      sql`${ledgerEntries.entryKind} in ('commission', 'refund')`,
    ));
  return {
    earnedCents: Math.round(Number(row?.total ?? 0)),
    salesCount: Number(row?.sales ?? 0),
  };
}

export interface ResolvedTakeRate {
  bps: number;
  /** What this seller has earned so far, and what they must pass. */
  lifetimeCents: number;
  thresholdCents: number;
  /** True while the platform is taking nothing. */
  underThreshold: boolean;
}

/**
 * THE RATE THIS SELLER PAYS RIGHT NOW.
 *
 * ── WHY THIS IS NOT A CONSTANT ───────────────────────────────────────────────
 * It used to be: one env var, the same 15% for everybody, charged from a
 * creator's first dollar. That is a fee for the privilege of trying, and every
 * comparable marketplace worth copying refuses to charge it — monday.com pays
 * 85/15 in the developer's favour but only past $200k lifetime, and Square and
 * Atlassian run the same shape. In year one the scarce resource is listings,
 * not margin.
 *
 * ── WHY IT IS STILL STAMPED ONTO THE ORDER LINE ──────────────────────────────
 * Resolving a rate per seller makes it a MOVING number, which makes stamping it
 * more important rather than less: the sale that carries a seller over the
 * threshold must not retroactively re-price the four hundred before it. The
 * stamp on `order_line_items.commissionCents` is what makes crossing the
 * threshold a change to future sales only.
 *
 * ── DELIBERATELY NOT CACHED ──────────────────────────────────────────────────
 * This is priced into a real charge and then written into an immutable ledger
 * row. A stale total either charges a fee that is not owed or misses one that
 * is, and both are wrong permanently. It costs one indexed SUM per purchase —
 * a purchase is not a hot path, and being correct at the instant of sale is the
 * whole job.
 */
export async function resolveTakeRateBps(
  db: Db,
  env: Env,
  seller: { tenantId: number | null; ref: string | null; accountKind?: SellerAccountKind },
): Promise<ResolvedTakeRate> {
  const thresholdCents = takeRateThresholdCents(env);
  const configured = platformTakeRateBps(env);

  // A platform-owned listing has nobody to credit and nobody to exempt. The
  // configured rate applies so the platform's own cut of its own listing is
  // still recorded rather than silently zero.
  if (seller.tenantId == null || !seller.ref) {
    return { bps: configured, lifetimeCents: 0, thresholdCents, underThreshold: false };
  }

  const { earnedCents } = await lifetimeSellerCents(db, seller.tenantId, seller.ref, seller.accountKind ?? 'user');
  const underThreshold = earnedCents < thresholdCents;
  return {
    bps: underThreshold ? 0 : configured,
    lifetimeCents: earnedCents,
    thresholdCents,
    underThreshold,
  };
}

export interface AcquisitionResult {
  orderId: number;
  orderNumber: string;
  licenseId: number;
  priceCents: number;
  commissionCents: number;
  sellerCents: number;
}

export interface AcquireInput {
  tenantId: number;
  buyerRef: string;
  buyerEmail?: string | null;
  slug: string;
  /**
   * A payment VERIFIED by this module against Stripe, never a value from a client.
   *
   * Internal on purpose: `acquireListing` is exported for the free path and
   * refuses to grant anything priced, and the only caller that can set this is
   * `completeListingCheckout`, which has just read `payment_status: 'paid'` back
   * from Stripe. An earlier draft took a `paymentIntentId` straight off the
   * request body — which is a paid product handed to anyone who posts a plausible
   * string.
   */
  verifiedPayment?: { paymentIntentId: string; amountCents: number } | null;
}

/**
 * Grant a listing to a buyer.
 *
 * Private. The two public doors are `acquireListing` (free only) and
 * `completeListingCheckout` (paid, after Stripe says the money moved), and having
 * ONE body under them is what stops the paid path from drifting into a second,
 * subtly different grant that forgets the licence or the ledger.
 */
async function grantListing(
  db: Db,
  env: Env,
  input: AcquireInput,
): Promise<AcquisitionResult> {
  // CROSS-TENANT BY DESIGN, and the one query here that is. A public catalogue is
  // bought FROM another workspace — filtering it by the buyer's tenant would mean
  // nobody could ever buy anything they had not already published themselves. The
  // seller's `tenantId` is selected rather than ignored because the money has to
  // land in THEIR ledger, not the buyer's; see `creditSeller` below.
  const [listing] = await db
    .select()
    .from(catalogItems)
    .where(acrossTenants(catalogItems, 'public_catalogue',
      eq(catalogItems.slug, input.slug),
      eq(catalogItems.visibility, 'public')))
    .limit(1);
  if (!listing) throw new ListingError('Listing not found', 404);

  const sellerTenantId = listing.tenantId;
  const body = (listing.body ?? {}) as { seller?: { userId?: string } };
  const sellerRef = listing.publisherRef ?? body.seller?.userId ?? null;
  if (sellerRef && sellerRef === input.buyerRef) {
    throw new ListingError('You already own what you published', 400);
  }

  const priceCents = listing.priceCents ?? 0;
  if (priceCents > 0 && !input.verifiedPayment) {
    throw new ListingError('This listing is paid — start checkout first', 400);
  }
  // The amount Stripe actually captured must match what is being granted. Without
  // this, a buyer could open checkout while a listing costs $1, wait for the seller
  // to raise it to $99, and complete the old session against the new price.
  if (input.verifiedPayment && input.verifiedPayment.amountCents < priceCents) {
    throw new ListingError('The payment does not cover this listing', 400);
  }

  // Already owned? Return the existing licence rather than charging again. The
  // unique index below is the real guarantee; this is the friendly path to it.
  const [held] = await db
    .select()
    .from(templateLicenses)
    .where(and(
      eq(templateLicenses.tenantId, input.tenantId),
      eq(templateLicenses.catalogItemId, listing.id),
      eq(templateLicenses.licenseeRef, input.buyerRef),
    ))
    .limit(1);
  if (held && !held.revokedAt) {
    return {
      orderId: held.orderId ?? 0,
      orderNumber: '',
      licenseId: held.id,
      priceCents,
      commissionCents: 0,
      sellerCents: 0,
    };
  }

  // Resolved per seller, not read from a constant: a creator under the lifetime
  // threshold pays nothing. Stamped onto the line below, so the sale that
  // carries them over never re-prices the ones before it.
  const { bps: takeRateBps } = await resolveTakeRateBps(db, env, {
    tenantId: sellerTenantId,
    ref: sellerRef,
  });
  const commissionCents = Math.round((priceCents * takeRateBps) / 10_000);
  const sellerCents = Math.max(0, priceCents - commissionCents);
  const orderNumber = `MP-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;

  const [order] = await db
    .insert(orders)
    .values({
      tenantId: input.tenantId,
      orderNumber,
      buyerRef: input.buyerRef,
      buyerEmail: input.buyerEmail ?? null,
      currency: listing.currency ?? 'USD',
      subtotalCents: priceCents,
      totalCents: priceCents,
      // A free acquisition is fulfilled the moment it is made; a paid one arrives
      // with the charge already captured, so both are 'paid' rather than pending.
      status: 'paid',
      provider: priceCents > 0 ? 'stripe' : null,
      providerRef: input.verifiedPayment?.paymentIntentId ?? null,
      fulfilledAt: new Date(),
    })
    .returning();
  if (!order) throw new ListingError('Could not record the order', 400);

  await registerObject(db, env, {
    tenantId: input.tenantId,
    kind: 'order',
    refId: order.id,
    domain: 'commerce',
    title: `${listing.name} — ${orderNumber}`,
  });

  await db.insert(orderLineItems).values({
    tenantId: input.tenantId,
    orderId: order.id,
    catalogItemId: listing.id,
    description: listing.name,
    quantity: 1,
    unitCents: priceCents,
    amountCents: priceCents,
    sellerRef,
    // Stamped, not derived at read time: changing the platform's rate tomorrow
    // must not silently re-price what somebody already sold today.
    commissionCents,
  });

  // WHICH VERSION THEY BOUGHT, recorded at the moment of sale (migration 0466).
  //
  // Without this the launch and install paths serve whatever the listing currently
  // points at, so a buyer's copy changes under them every time the seller
  // re-publishes — and a seller who ships a broken version takes every existing
  // buyer with them. Read off the listing body here rather than passed in: the
  // snapshot a sale is against is a fact about the listing at this instant, and a
  // caller-supplied id is one a caller could get wrong.
  const boughtSnapshotId = (listing.body as { snapshotId?: string } | null)?.snapshotId ?? null;

  const [licence] = await db
    .insert(templateLicenses)
    .values({
      tenantId: input.tenantId,
      catalogItemId: listing.id,
      licenseeRef: input.buyerRef,
      scope: 'single',
      orderId: order.id,
      snapshotId: boughtSnapshotId,
    })
    .onConflictDoUpdate({
      target: [templateLicenses.tenantId, templateLicenses.catalogItemId, templateLicenses.licenseeRef],
      // Re-acquiring after a revocation restores the licence rather than failing —
      // a refunded buyer who buys again is a customer, not a conflict. Re-pinned to
      // what is on sale NOW, because that is what they have just paid for.
      set: { revokedAt: null, orderId: order.id, snapshotId: boughtSnapshotId, updatedAt: new Date() },
    })
    .returning();
  if (!licence) throw new ListingError('Could not grant the licence', 400);

  // A sale with no seller tenant is a platform-owned listing; there is nobody to
  // credit, and inventing an account for it would put money in a workspace that
  // does not exist.
  if (priceCents > 0 && sellerRef && sellerTenantId != null) {
    await creditSeller(db, {
      sellerTenantId,
      sellerRef,
      orderId: order.id,
      listingName: listing.name,
      sellerCents,
      commissionCents,
    });
  }

  await recordInstall(db, env, listing.id);

  // A completed acquisition IS the `purchase` event a workflow can react to
  // ("somebody bought the onboarding template → send them the welcome sequence").
  // Fired after the licence and the seller credit, so a workflow that reads the
  // order finds a settled one. The listing's slug and its catalog-item id are both
  // offered as aliases for the builder's "Product / SKU" filter.
  await fireEventTriggers(db, {
    tenantId: input.tenantId, env,
    eventType: 'purchase',
    payload: {
      orderId: order.id, orderNumber, licenseId: licence.id,
      listingSlug: listing.slug, listingName: listing.name,
      priceCents, currency: listing.currency ?? 'USD',
      buyerRef: input.buyerRef, buyerEmail: input.buyerEmail ?? null,
    },
    match: { sku: [listing.slug, listing.id] },
  }).catch(() => undefined);

  return {
    orderId: order.id,
    orderNumber,
    licenseId: licence.id,
    priceCents,
    commissionCents,
    sellerCents,
  };
}

/**
 * Take a FREE listing.
 *
 * Deliberately cannot grant a paid one: it passes no `verifiedPayment`, so
 * `grantListing` refuses anything with a price. The paid door is checkout.
 */
export async function acquireListing(
  db: Db,
  env: Env,
  input: { tenantId: number; buyerRef: string; buyerEmail?: string | null; slug: string },
): Promise<AcquisitionResult> {
  return grantListing(db, env, { ...input, verifiedPayment: null });
}

/**
 * Send a buyer to Stripe for a paid listing.
 *
 * Stripe's HOSTED checkout, the same surface the plan and business-phone flows
 * already use — one payment integration on this platform, not a second one built
 * out of card fields. Nothing is granted here; the session is only an invitation
 * to pay, and it is `completeListingCheckout` that decides whether it was paid.
 */
export async function startListingCheckout(
  db: Db,
  env: Env,
  input: { tenantId: number; buyerRef: string; buyerEmail?: string | null; slug: string; returnUrl: string },
): Promise<{ checkoutUrl: string }> {
  const [listing] = await db
    .select()
    .from(catalogItems)
    .where(acrossTenants(catalogItems, 'public_catalogue',
      eq(catalogItems.slug, input.slug), eq(catalogItems.visibility, 'public')))
    .limit(1);
  if (!listing) throw new ListingError('Listing not found', 404);

  const priceCents = listing.priceCents ?? 0;
  if (priceCents <= 0) throw new ListingError('This listing is free — no checkout is needed', 400);
  if (listing.publisherRef === input.buyerRef) {
    throw new ListingError('You already own what you published', 400);
  }
  if (await holdsLicence(db, input.tenantId, input.buyerRef, listing.id)) {
    throw new ListingError('You already own this', 400);
  }
  if (!env.STRIPE_SECRET_KEY) {
    throw new ListingError('Payments are not configured on this deployment', 400);
  }

  const base = new URL(input.returnUrl);
  const session = await buildPaymentProvider(env).createOneTimeCheckoutSession({
    amountCents: priceCents,
    currency: listing.currency ?? 'USD',
    productName: listing.name,
    billingEmail: input.buyerEmail ?? null,
    // `{CHECKOUT_SESSION_ID}` is substituted by Stripe, so the value that comes
    // back is one Stripe minted — and it is still re-read from Stripe before it
    // grants anything.
    successUrl: `${base.origin}${base.pathname}?checkout={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${base.origin}${base.pathname}?checkout=cancelled`,
    metadata: {
      purchaseKind: 'marketplace_listing',
      listingId: listing.id,
      listingSlug: listing.slug,
      buyerRef: input.buyerRef,
      buyerTenantId: String(input.tenantId),
    },
    idempotencyKey: `mp-checkout:${listing.id}:${input.buyerRef}`,
  });
  return { checkoutUrl: session.checkoutUrl };
}

/**
 * Finish a paid acquisition.
 *
 * THE VERIFICATION IS THE POINT. The session id arrives in a redirect URL, which
 * is to say it arrives from the buyer's address bar. Everything that authorises
 * the grant is read back from Stripe: that the session was paid, what it was for,
 * how much it captured, and — the check that a naive implementation forgets —
 * that the buyer completing it is the buyer it was created for. Without that last
 * one, one person's paid session grants a licence to whoever pastes its id.
 */
export async function completeListingCheckout(
  db: Db,
  env: Env,
  input: { tenantId: number; buyerRef: string; buyerEmail?: string | null; checkoutSessionId: string },
): Promise<AcquisitionResult> {
  const verified = await verifyPaidCheckout(env, {
    checkoutSessionId: input.checkoutSessionId,
    purchaseKind: 'marketplace_listing',
    owner: { buyerRef: input.buyerRef, buyerTenantId: input.tenantId },
    messages: {
      notConfigured: 'Payments are not configured on this deployment',
      notFound: 'That checkout could not be found',
      notPaid: 'That checkout has not been paid',
      wrongKind: 'That checkout was not for a listing',
      notYours: 'That checkout belongs to someone else',
    },
    refuse: (message, status) => new ListingError(message, status),
  });

  const slug = verified.metadata.listingSlug;
  if (!slug) throw new ListingError('That checkout names no listing', 400);

  return grantListing(db, env, {
    tenantId: input.tenantId,
    buyerRef: input.buyerRef,
    buyerEmail: input.buyerEmail ?? verified.customerEmail,
    slug,
    verifiedPayment: {
      paymentIntentId: verified.paymentRef,
      amountCents: verified.amountCents,
    },
  });
}

/**
 * The two ledger entries a sale produces.
 *
 * Written as ONE insert of two rows so the seller's earning and the platform's cut
 * cannot land separately — a partial write here is a book that does not balance,
 * and the unique index on `reference` means a retry of the pair is refused whole.
 *
 * THE TENANT ON THESE ROWS IS THE SELLER'S, NOT THE BUYER'S. Every other row a
 * sale writes (order, line, licence) belongs to the buyer's workspace, and taking
 * that tenant for the ledger too was a bug that survived until the tenant-scope
 * guard asked what tenant this was: the earning would have landed in the customer's
 * books, `sellerEarnings` would have found nothing in the seller's, and every
 * payout balance on the platform would have read zero forever.
 */
async function creditSeller(db: Db, input: {
  sellerTenantId: number;
  sellerRef: string;
  orderId: number;
  listingName: string;
  sellerCents: number;
  commissionCents: number;
}): Promise<void> {
  await db.insert(ledgerEntries).values([
    {
      tenantId: input.sellerTenantId,
      // The seller's balance is a USER balance, because that is the account the
      // payout subsystem already pays from (`PayoutAccountService.paidCents`).
      // A separate 'seller' account would make earned and paid unsubtractable.
      accountKind: 'user',
      accountRef: input.sellerRef,
      denomination: USD_CENTS,
      amount: String(input.sellerCents),
      entryKind: 'commission',
      reference: `mp-sale:${input.orderId}`,
      memo: `Marketplace sale — ${input.listingName}`,
      metadata: { source: 'marketplace_listing', orderId: input.orderId },
    },
    {
      tenantId: input.sellerTenantId,
      accountKind: 'partner',
      accountRef: 'platform',
      denomination: USD_CENTS,
      amount: String(input.commissionCents),
      entryKind: 'commission',
      reference: `mp-fee:${input.orderId}`,
      memo: `Platform fee — ${input.listingName}`,
      metadata: { source: 'marketplace_listing', orderId: input.orderId },
    },
  ]).onConflictDoNothing();
}

// ---------------------------------------------------------------------------
// Entitlement
// ---------------------------------------------------------------------------

/**
 * Does this person hold a live licence for this listing?
 *
 * Deliberately NOT cached. It is the gate in front of a paid product, and a cache
 * is how a revoked licence keeps working for a TTL — the same reasoning the kernel
 * applies to share tokens.
 */
async function holdsLicence(
  db: Db,
  tenantId: number,
  buyerRef: string,
  listingId: string,
): Promise<boolean> {
  return (await heldLicence(db, tenantId, buyerRef, listingId)) !== null;
}

/**
 * The live licence itself, so a caller can serve THE VERSION THIS BUYER HOLDS.
 *
 * This is the read; `holdsLicence` above is the same question with the answer thrown
 * away, and it is now module-private because every caller outside this file needs the
 * extra fact: which snapshot the buyer paid for. Two queries asking the same thing is
 * how "do they own it" and "what do they own" drift apart, so there is one read and
 * the boolean is derived from it.
 *
 * `snapshotId` is null for licences granted before migration 0466, which is the
 * honest answer — nothing recorded what those buyers received — and every caller
 * treats null as "serve the listing's current snapshot", which is exactly what they
 * were being served already.
 */
export async function heldLicence(
  db: Db,
  tenantId: number,
  buyerRef: string,
  listingId: string,
): Promise<{ id: number; snapshotId: string | null } | null> {
  const [row] = await db
    .select({
      id: templateLicenses.id,
      revokedAt: templateLicenses.revokedAt,
      expiresAt: templateLicenses.expiresAt,
      snapshotId: templateLicenses.snapshotId,
    })
    .from(templateLicenses)
    .where(and(
      eq(templateLicenses.tenantId, tenantId),
      eq(templateLicenses.catalogItemId, listingId),
      eq(templateLicenses.licenseeRef, buyerRef),
    ))
    .limit(1);
  if (!row || row.revokedAt) return null;
  if (row.expiresAt && row.expiresAt <= new Date()) return null;
  return { id: row.id, snapshotId: row.snapshotId };
}

/**
 * Is the caller behind this Authorization header entitled to this listing?
 *
 * The PUBLIC launch endpoint needs to answer this without being able to reject:
 * a signed-out visitor and a visitor with a stale token both want the same thing
 * from that URL — the free-or-preview experience — so anything that is not a valid
 * workspace token holding a live licence resolves to "not entitled" rather than to a
 * 401. It also answers WHICH VERSION they hold, so the buyer is served the build they
 * paid for rather than whatever the seller published since.
 *
 * It lives in the application layer rather than in the route because the route may
 * not reach into infrastructure, and token verification is infrastructure. That is
 * also the honest boundary: "is this person entitled" is a use case, not transport.
 */
export async function entitlementFromAuthHeader(
  db: Db,
  env: Env,
  authorization: string | undefined,
  listingId: string,
): Promise<{ entitled: boolean; snapshotId: string | null }> {
  const anonymous = { entitled: false, snapshotId: null };
  if (!authorization?.startsWith('Bearer ')) return anonymous;
  try {
    const payload = await verifyJwt(authorization.slice(7), env.JWT_SECRET);
    const tenantId = Number(payload.tid ?? 0);
    if (!(tenantId > 0) || !payload.sub) return anonymous;
    const licence = await heldLicence(db, tenantId, payload.sub, listingId);
    // The pinned snapshot rides along because the launch endpoint needs both facts
    // and reading the licence twice is how they come to disagree.
    return licence ? { entitled: true, snapshotId: licence.snapshotId } : anonymous;
  } catch {
    // An unreadable, expired or workspace-less token is "not entitled", which is
    // the same answer as no token at all — not an error the visitor can act on.
    return anonymous;
  }
}

/** Everything this person has acquired, newest first. */
export async function acquiredListings(db: Db, tenantId: number, buyerRef: string) {
  return db
    .select({
      listingId: catalogItems.id,
      slug: catalogItems.slug,
      name: catalogItems.name,
      kind: catalogItems.kind,
      acquiredAtISO: templateLicenses.createdAt,
      revokedAt: templateLicenses.revokedAt,
    })
    .from(templateLicenses)
    .innerJoin(catalogItems, eq(catalogItems.id, templateLicenses.catalogItemId))
    .where(and(
      eq(templateLicenses.tenantId, tenantId),
      eq(templateLicenses.licenseeRef, buyerRef),
    ))
    .orderBy(desc(templateLicenses.createdAt));
}

// ---------------------------------------------------------------------------
// Refund
// ---------------------------------------------------------------------------

/**
 * Reverse a sale.
 *
 * Three things move together, and the order is not arbitrary: the licence is
 * revoked FIRST, so the moment money starts coming back the buyer has already
 * stopped being able to use the product. Reversing the ledger first would leave a
 * window in which the thing is both refunded and usable.
 *
 * The seller's clawback is written even if it drives their balance negative. A
 * balance that refuses to go negative is a balance that pays out money already
 * returned to a customer.
 */
export async function refundListingOrder(
  db: Db,
  env: Env,
  input: { tenantId: number; orderId: number; actorRef: string },
): Promise<{ refundedCents: number }> {
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, input.orderId), eq(orders.tenantId, input.tenantId)))
    .limit(1);
  if (!order) throw new ListingError('Order not found', 404);
  if (order.status === 'refunded') return { refundedCents: order.totalCents };

  const [line] = await db
    .select()
    .from(orderLineItems)
    .where(and(
      eq(orderLineItems.tenantId, input.tenantId),
      eq(orderLineItems.orderId, order.id),
    ))
    .limit(1);
  if (!line?.catalogItemId) throw new ListingError('This order has nothing to refund', 400);

  // The clawback goes back to the tenant the earning was CREDITED to — the
  // seller's, not the refunding buyer's. Reversing it in the buyer's books would
  // leave the seller's balance still holding money that has been given back.
  const [sold] = await db
    .select({ tenantId: catalogItems.tenantId, slug: catalogItems.slug })
    .from(catalogItems)
    .where(acrossTenants(catalogItems, 'public_catalogue', eq(catalogItems.id, line.catalogItemId)))
    .limit(1);
  const sellerTenantId = sold?.tenantId ?? null;

  await db
    .update(templateLicenses)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(and(
      eq(templateLicenses.tenantId, input.tenantId),
      eq(templateLicenses.catalogItemId, line.catalogItemId),
      eq(templateLicenses.licenseeRef, order.buyerRef ?? ''),
    ));

  const sellerCents = Math.max(0, line.amountCents - line.commissionCents);
  if (sellerCents > 0 && line.sellerRef && sellerTenantId != null) {
    await db.insert(ledgerEntries).values([
      {
        tenantId: sellerTenantId,
        accountKind: 'user',
        accountRef: line.sellerRef,
        denomination: USD_CENTS,
        amount: String(-sellerCents),
        entryKind: 'refund',
        reference: `mp-refund:${order.id}`,
        memo: `Refunded — ${line.description}`,
        metadata: { source: 'marketplace_listing', orderId: order.id, actorRef: input.actorRef },
      },
      {
        tenantId: sellerTenantId,
        accountKind: 'partner',
        accountRef: 'platform',
        denomination: USD_CENTS,
        amount: String(-line.commissionCents),
        entryKind: 'refund',
        reference: `mp-fee-refund:${order.id}`,
        memo: `Fee reversed — ${line.description}`,
        metadata: { source: 'marketplace_listing', orderId: order.id },
      },
    ]).onConflictDoNothing();
  }

  await db
    .update(orders)
    .set({ status: 'refunded', refundedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(orders.tenantId, input.tenantId), eq(orders.id, order.id)));

  // The install count is a measure of live users, not of transactions ever made.
  // Cross-tenant on purpose, like every other write to the catalogue: the row
  // belongs to the SELLER, and the refund is happening in the buyer's workspace.
  await db
    .update(catalogItems)
    .set({ installCount: sql`greatest(0, ${catalogItems.installCount} - 1)` })
    .where(and(
      eq(catalogItems.id, line.catalogItemId),
      sellerTenantId == null ? isNull(catalogItems.tenantId) : eq(catalogItems.tenantId, sellerTenantId),
    ));

  await invalidateListingCaches(env, sold?.slug);

  return { refundedCents: order.totalCents };
}

// ---------------------------------------------------------------------------
// Earnings and payout
// ---------------------------------------------------------------------------

export interface SellerEarnings {
  /** Gross — commission plus refund, never netted against maintenance cost, so
   *  it stays the same number the take-rate threshold reads. */
  earnedCents: number;
  paidCents: number;
  /** Gross earned, minus what has left, minus this seller's hosted apps' agent
   *  maintenance cost — see `appMaintenanceCost.ts`. Never negative. */
  availableCents: number;
  salesCount: number;
  /** What this seller's hosted apps have cost in agent runs, ever — already
   *  netted into `availableCents`; broken out here so the earnings page can
   *  show it as its own line rather than a silent gap between sales and payout. */
  maintenanceCostCents: number;
  /** The rate this seller pays on their NEXT sale, and how far they are from
   *  the threshold. Returned with the balance because a creator reading their
   *  earnings is exactly the person asking "when does the fee start". */
  takeRate: ResolvedTakeRate;
}

/**
 * What this seller has earned, net of refunds.
 *
 * ONE indexed SUM over the account index, never a fetch-and-add: a seller with
 * three thousand sales must not pull three thousand rows to see one number.
 * `commission` and `refund` are summed TOGETHER because a refund is written as a
 * negative entry — the balance is the sum of the account, which is what a ledger is
 * for and what a separate "refunds" subtraction would eventually disagree with.
 */
export async function sellerEarnings(
  db: Db,
  env: Env,
  tenantId: number,
  userId: string,
): Promise<SellerEarnings> {
  // The SAME sum the take-rate resolver reads. Two queries answering "what has
  // this seller earned" is how the rate a buyer is charged and the figure the
  // seller is shown come to disagree.
  const { earnedCents, salesCount } = await lifetimeSellerCents(db, tenantId, userId);
  // Bring every hosted app this seller publishes up to date BEFORE reading what
  // it has cost — otherwise a payout computed in the same instant a run lands
  // could pay out cost that was never charged.
  await chargeAllHostedAppMaintenance(db, tenantId, userId);
  const [maintenanceCostCents, takeRate] = await Promise.all([
    sellerMaintenanceCostCents(db, tenantId, userId),
    resolveTakeRateBps(db, env, { tenantId, ref: userId }),
  ]);
  const balance = await new PayoutAccountService(db, env)
    .balance(tenantId, userId, Math.max(0, earnedCents - maintenanceCostCents));
  // `balance.earnedCents` is the NET figure `PayoutAccountService` computed
  // available-from; overridden back to gross here so this field keeps meaning
  // "what this seller has sold", matching what `resolveTakeRateBps` reads.
  return { ...balance, earnedCents, maintenanceCostCents, salesCount, takeRate };
}

/**
 * Pay a seller out.
 *
 * The amount is the AVAILABLE balance computed here, never a number the caller
 * supplied — a payout endpoint that accepts an amount is an endpoint that pays
 * whatever a crafted request asks for. `PayoutAccountService.pay` owns the vendor
 * call and the idempotency key end to end; this function's whole job is to decide
 * that there is something to pay and how much.
 */
export async function payoutSellerBalance(
  db: Db,
  env: Env,
  tenantId: number,
  userId: string,
): Promise<{ ok: boolean; amountCents: number; error?: string }> {
  const earnings = await sellerEarnings(db, env, tenantId, userId);
  if (earnings.availableCents <= 0) {
    return { ok: false, amountCents: 0, error: 'There is nothing available to pay out' };
  }
  const result = await new PayoutAccountService(db, env).pay({
    userId,
    tenantId,
    amountCents: earnings.availableCents,
    reference: `mp-payout:${tenantId}:${userId}:${earnings.earnedCents}`,
    memo: 'Marketplace earnings',
  });
  return result.ok
    ? { ok: true, amountCents: earnings.availableCents }
    : { ok: false, amountCents: 0, error: result.error };
}
