/**
 * BUYING A MARKETPLACE VOICE — the paid half of the voice marketplace.
 *
 * ── ONE PAYMENT MACHINE ──────────────────────────────────────────────────────
 * The processor round-trip is `finance/verifiedCheckout`, the same primitive the
 * agent, skill, knowledge and creation listings use; the seller split is
 * `finance/saleLedger.recordSaleSplit` with the marketplace's own
 * `resolveTakeRateBps`. This module contributes only what is its own: which voice,
 * who may buy it, and that a paid purchase becomes an active
 * `studio_voice_clone_licenses` row (the grant `canUseClone` already honours).
 * It is settled by BOTH legs — the buyer's redirect (`completeVoiceCheckout` via the
 * route) and the webhook (`purchaseRegistry`) — and both re-read the session from
 * the processor, so nothing is granted on the client's word.
 *
 * The license row IS the sale record (unique clone+tenant), and the ledger pair is
 * keyed on its id, so a replayed redirect or webhook collides in the database.
 * No `marketplace_purchases` row: its `artifact_type` enum has no voice value and
 * the license already answers "does this workspace hold it".
 */

import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { ledgerEntries, studioVoiceCloneLicenses, studioVoiceClones } from '../../infrastructure/database/schema';
import { trustedReturnUrl } from '../shared/trustedReturnUrl';
import { buildPaymentProvider } from '../../infrastructure/payment';
import { bumpCacheVersion } from '../../infrastructure/cache/readThroughCache';
import { ListingError } from '../marketplace/creationListings';
import { resolveTakeRateBps } from '../marketplace/listingCommerce';
import { assertCovers, verifyPaidCheckout } from '../finance/verifiedCheckout';
import { recordSaleSplit } from '../finance/saleLedger';

/** What this flow calls itself in checkout metadata. */
export const VOICE_PURCHASE_KIND = 'marketplace_voice';

const MILLICENTS_PER_CENT = 1000;
const refuse = (message: string, status: 400 | 403 | 404) => new ListingError(message, status);

type CloneRow = typeof studioVoiceClones.$inferSelect;

/** A voice price in whole cents (a sub-cent price still charges one cent). */
export function voicePriceCents(clone: Pick<CloneRow, 'priceMillicents'>): number {
  return clone.priceMillicents <= 0 ? 0 : Math.max(1, Math.ceil(clone.priceMillicents / MILLICENTS_PER_CENT));
}

async function loadPurchasableVoice(db: Db, cloneId: number): Promise<CloneRow | null> {
  const [clone] = await db.select().from(studioVoiceClones).where(eq(studioVoiceClones.id, cloneId)).limit(1);
  // A voice that is not published to the marketplace does not exist to a buyer.
  if (!clone || clone.visibility !== 'marketplace' || clone.status !== 'published') return null;
  return clone;
}

export async function holdsVoiceLicense(db: Db, tenantId: number, cloneId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: studioVoiceCloneLicenses.id })
    .from(studioVoiceCloneLicenses)
    .where(and(
      eq(studioVoiceCloneLicenses.cloneId, cloneId),
      eq(studioVoiceCloneLicenses.tenantId, tenantId),
      eq(studioVoiceCloneLicenses.status, 'active'),
    ))
    .limit(1);
  return Boolean(row);
}

/** The license row's status in ANY state (`active` | `revoked`), or null when none exists. */
async function voiceLicenseStatus(db: Db, tenantId: number, cloneId: number): Promise<string | null> {
  const [row] = await db
    .select({ status: studioVoiceCloneLicenses.status })
    .from(studioVoiceCloneLicenses)
    .where(and(eq(studioVoiceCloneLicenses.cloneId, cloneId), eq(studioVoiceCloneLicenses.tenantId, tenantId)))
    .limit(1);
  return row ? row.status : null;
}

/** Send a buyer to the processor's hosted page for a priced voice. Grants nothing. */
export async function startVoiceCheckout(
  db: Db,
  env: Env,
  input: { tenantId: number; buyerUserId: string; buyerEmail?: string | null; cloneId: number; returnUrl?: string | undefined },
): Promise<{ checkoutUrl: string }> {
  const clone = await loadPurchasableVoice(db, input.cloneId);
  if (!clone) throw new ListingError('Voice not found', 404);
  const priceCents = voicePriceCents(clone);
  if (priceCents <= 0) throw new ListingError('This voice is free — no checkout is needed', 400);
  if (clone.tenantId === input.tenantId) throw new ListingError('You already own what you published', 400);
  // A seller must exist to be paid: refuse rather than take money nobody can be credited with.
  if (!clone.userId) throw new ListingError('This voice has no owner to pay and cannot be sold', 400);
  // ANY existing row blocks a purchase. An active one is owned; a revoked one was refunded or
  // disputed, and re-buying it would resurrect a license the platform just took back.
  const held = await voiceLicenseStatus(db, input.tenantId, clone.id);
  if (held === 'active') throw new ListingError('You already own this', 400);
  if (held !== null) throw new ListingError('You already own a revoked license for this voice; it cannot be bought again', 400);
  if (!env.STRIPE_SECRET_KEY) throw new ListingError('Payments are not configured on this deployment', 400);

  const base = trustedReturnUrl(env, input.returnUrl, '/marketplace/voices');
  const session = await buildPaymentProvider(env).createOneTimeCheckoutSession({
    amountCents: priceCents,
    currency: 'USD',
    productName: clone.name,
    billingEmail: input.buyerEmail ?? null,
    // Only ORIGIN + PATH of the caller's url are kept; the voice id is re-attached
    // from the row so the return leg knows WHICH purchase to complete.
    successUrl: `${base.origin}${base.pathname}?checkout={CHECKOUT_SESSION_ID}&voice=${clone.id}`,
    cancelUrl: `${base.origin}${base.pathname}?checkout=cancelled`,
    metadata: {
      purchaseKind: VOICE_PURCHASE_KIND,
      cloneId: String(clone.id),
      buyerTenantId: String(input.tenantId),
      buyerUserId: input.buyerUserId,
    },
    // Buyer user and price are part of the key: a different buyer in the same workspace, or
    // the same buyer after a price change, must get a fresh session, never a replay of the old.
    idempotencyKey: `voice-checkout:${clone.id}:${input.tenantId}:${input.buyerUserId}:${priceCents}`,
  });
  return { checkoutUrl: session.checkoutUrl };
}

export interface VoicePurchase {
  applied: true;
  licenseId: number;
  cloneId: number;
  /** What the processor actually captured, in cents. */
  priceCents: number;
  commissionCents: number;
  sellerCents: number;
}

/** The purchase did not grant: the license row exists but is not active (refunded / disputed). */
export interface VoicePurchaseNotApplied {
  applied: false;
  reason: 'license_revoked';
}

/**
 * Finish a paid voice acquisition — from the redirect OR the webhook.
 *
 * Never resurrects a revoked license: the insert is `onConflictDoNothing`, and when the
 * row that results is not `active` (a refund or dispute got there first, including a
 * tombstone written before this arrived) nothing is granted, no ledger line is written
 * and the result says so — it never claims a purchase it did not make.
 */
export async function completeVoiceCheckout(
  db: Db,
  env: Env,
  input: { tenantId: number; buyerUserId: string; checkoutSessionId: string },
): Promise<VoicePurchase | VoicePurchaseNotApplied> {
  const verified = await verifyPaidCheckout(env, {
    checkoutSessionId: input.checkoutSessionId,
    purchaseKind: VOICE_PURCHASE_KIND,
    owner: { buyerTenantId: input.tenantId },
    messages: {
      notConfigured: 'Payments are not configured on this deployment',
      notFound: 'That checkout could not be found',
      notPaid: 'That checkout has not been paid',
      wrongKind: 'That checkout was not for a marketplace voice',
      notYours: 'That checkout belongs to someone else',
    },
    refuse,
  });

  const cloneId = Number(verified.metadata.cloneId);
  if (!Number.isInteger(cloneId)) throw new ListingError('That checkout names no voice', 400);
  const clone = await loadPurchasableVoice(db, cloneId);
  if (!clone) throw new ListingError('Voice not found', 404);
  // Open at the old price, complete after the seller raised it: refused.
  assertCovers(verified, voicePriceCents(clone), 'The payment does not cover this voice', refuse);

  await db
    .insert(studioVoiceCloneLicenses)
    .values({ tenantId: input.tenantId, userId: input.buyerUserId, cloneId: clone.id, status: 'active' })
    .onConflictDoNothing({ target: [studioVoiceCloneLicenses.cloneId, studioVoiceCloneLicenses.tenantId] });
  const [license] = await db
    .select({ id: studioVoiceCloneLicenses.id, status: studioVoiceCloneLicenses.status })
    .from(studioVoiceCloneLicenses)
    .where(and(eq(studioVoiceCloneLicenses.cloneId, clone.id), eq(studioVoiceCloneLicenses.tenantId, input.tenantId)))
    .limit(1);
  if (!license) throw new ListingError('Could not record the purchase', 400);
  if (license.status !== 'active') return { applied: false, reason: 'license_revoked' };

  // The seller is the enrolling user's account in the owning workspace; a clone with
  // no owner is not sellable (refused at checkout start), and is refused again here.
  const sellerRef = clone.userId;
  if (!sellerRef) throw new ListingError('This voice has no owner to pay', 400);
  // The split is of what was actually CHARGED, not of today's list price.
  const paidCents = verified.amountCents;
  const { bps } = await resolveTakeRateBps(db, env, { tenantId: clone.tenantId, ref: sellerRef });
  const commissionCents = Math.round((paidCents * bps) / 10_000);
  const sellerCents = paidCents - commissionCents;
  await recordSaleSplit(db, {
    sellerTenantId: clone.tenantId,
    sellerRef,
    referencePrefix: 'voice',
    saleId: license.id,
    saleIdKey: 'licenseId',
    source: 'marketplace_voice',
    saleLabel: 'Voice sale',
    subject: clone.name,
    sellerCents,
    commissionCents,
  });
  // REFUND RACE. The status read above and the split just written are not one statement, so a
  // reversal can land between them: it revoked the licence and read an empty ledger, and the
  // seller would stay credited for a refunded sale. Re-read the licence AFTER the split; if it is
  // now revoked, run the (idempotent: unique references) reversal again, which this time sees the
  // rows just written. The other ordering (reversal after the split) is the reversal's own read.
  if ((await voiceLicenseStatus(db, input.tenantId, clone.id)) === 'revoked') {
    await reverseVoicePurchase(db, env, { tenantId: input.tenantId, cloneId: clone.id });
    return { applied: false, reason: 'license_revoked' };
  }
  // Both legs (redirect, webhook) land here, so the buyer's cached list refreshes on either.
  await bumpCacheVersion(env, `voiceclones:${input.tenantId}`);
  return { applied: true, licenseId: license.id, cloneId: clone.id, priceCents: paidCents, commissionCents, sellerCents };
}

/**
 * Take back a voice purchase whose money went back to the buyer (full refund or dispute).
 *
 * The license is revoked FIRST (the buyer stops being able to use the voice before any
 * money moves), then the seller's earning and the platform fee are reversed exactly as
 * recorded — `voice-sale-reversal:<licenseId>` / `voice-fee-reversal:<licenseId>`, unique
 * references, so a redelivered event writes nothing twice. If no license row exists yet
 * (the refund beat the checkout) a REVOKED tombstone is written so the late
 * `checkout.completed` cannot grant. Safe to call any number of times.
 */
export async function reverseVoicePurchase(
  db: Db,
  env: Env,
  input: { tenantId: number; cloneId: number },
): Promise<{ reversed: boolean; licenseId: number }> {
  const before = await voiceLicenseStatus(db, input.tenantId, input.cloneId);
  const [license] = await db
    .insert(studioVoiceCloneLicenses)
    .values({ tenantId: input.tenantId, userId: null, cloneId: input.cloneId, status: 'revoked' })
    .onConflictDoUpdate({
      target: [studioVoiceCloneLicenses.cloneId, studioVoiceCloneLicenses.tenantId],
      set: { status: 'revoked' },
    })
    .returning({ id: studioVoiceCloneLicenses.id });
  if (!license) throw new ListingError('Could not revoke the license', 400);

  const saleRef = `voice-sale:${license.id}`;
  const feeRef = `voice-fee:${license.id}`;
  const originals = await db
    .select()
    .from(ledgerEntries)
    .where(inArray(ledgerEntries.reference, [saleRef, feeRef]));
  const reversals = originals.map((e) => ({
    tenantId: e.tenantId,
    accountKind: e.accountKind,
    accountRef: e.accountRef,
    denomination: e.denomination,
    amount: String(-Number(e.amount)),
    entryKind: 'refund',
    reference: e.reference === saleRef ? `voice-sale-reversal:${license.id}` : `voice-fee-reversal:${license.id}`,
    memo: `Refunded — ${e.memo ?? 'voice sale'}`,
    metadata: { source: 'marketplace_voice', licenseId: license.id, reverses: e.reference },
  }));
  // A negative balance is correct: the money is already back with the buyer.
  if (reversals.length > 0) await db.insert(ledgerEntries).values(reversals).onConflictDoNothing();

  await bumpCacheVersion(env, `voiceclones:${input.tenantId}`);
  return { reversed: before !== 'revoked', licenseId: license.id };
}

