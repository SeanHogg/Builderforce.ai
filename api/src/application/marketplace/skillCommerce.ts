/**
 * BUYING A MARKETPLACE SKILL (OR PERSONA) — the paid half of the cart.
 *
 * Creation listings and workforce agents already go start*Checkout → processor
 * hosted session → verifyPaidCheckout → grant. The skill/persona cart did not:
 * `POST /marketplace/purchase` accepted a client-supplied `stripePaymentIntentId`
 * and wrote the purchase row without re-reading the intent from Stripe. A
 * plausible string granted a paid skill. This module is the same door the other
 * two flows already walk, so a skill is not a second fee rule and not a second
 * payment machine.
 *
 * ── NOTHING IS GRANTED BEFORE THE PROCESSOR SAYS SO ───────────────────────────
 * `startSkillCheckout` mints an invitation to pay and records nothing.
 * `completeSkillCheckout` re-reads the session FROM the processor and only then
 * writes the purchase. The partial unique index on
 * `(user_id, artifact_type, artifact_slug) WHERE tenant_id IS NULL` makes a
 * replayed redirect land on the row that is already there rather than on a
 * second charge.
 *
 * ── USER-SCOPED, NOT WORKSPACE-SCOPED ────────────────────────────────────────
 * A skill or persona is bought by a PERSON from the marketing marketplace,
 * where no workspace need exist. The purchase row carries `userId` and a null
 * `tenantId`. The webhook settler therefore reads `buyerUserId` from signed
 * metadata rather than requiring a tenant id.
 *
 * ── THE SELLER GETS PAID ─────────────────────────────────────────────────────
 * A sale credits the author's user account and the platform's cut as two
 * `ledger_entries` rows in ONE insert, keyed on the purchase so a retry collides
 * in the database. The take rate is resolved through the marketplace's own
 * `resolveTakeRateBps`, so a skill author under the lifetime threshold pays
 * nothing on a skill exactly as they pay nothing on a creation or a runbook.
 *
 * Personas currently have no `price_cents` column, so they are free and this
 * module refuses to take money for them. The same functions still load a
 * published persona so a later price is one column, not a second checkout.
 */

import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  ledgerEntries,
  marketplacePersonas,
  marketplacePurchases,
  marketplaceSkills,
  users,
} from '../../infrastructure/database/schema';
import { buildPaymentProvider } from '../../infrastructure/payment';
import { ListingError } from './creationListings';
import { resolveTakeRateBps } from './listingCommerce';
import { verifyPaidCheckout, assertCovers } from '../finance/verifiedCheckout';
import { USD_CENTS } from '../kernel/denominations';


/** What this flow calls itself in checkout metadata. Skills and personas share it. */
export const SKILL_PURCHASE_KIND = 'marketplace_skill';

export type SkillArtifactType = 'skill' | 'persona';

const refuse = (message: string, status: 400 | 403 | 404) => new ListingError(message, status);

export interface SkillPurchase {
  purchaseId: number;
  artifactType: SkillArtifactType;
  artifactSlug: string;
  priceCents: number;
  /** Zero while the seller is under the lifetime threshold. */
  commissionCents: number;
  sellerCents: number;
}

/** The fields a sale needs off the published row. */
interface PurchasableArtifact {
  type: SkillArtifactType;
  slug: string;
  name: string;
  authorId: string | null;
  priceCents: number;
  pricingModel: 'flat_fee' | 'consumption';
  /** The author's default workspace — ledger rows need a tenant. Null = nobody to pay. */
  sellerTenantId: number | null;
}

async function loadPurchasableSkill(db: Db, slug: string): Promise<PurchasableArtifact | null> {
  const [skill] = await db
    .select({
      slug: marketplaceSkills.slug,
      name: marketplaceSkills.name,
      authorId: marketplaceSkills.authorId,
      priceCents: marketplaceSkills.priceCents,
      pricingModel: marketplaceSkills.pricingModel,
      sellerTenantId: users.defaultTenantId,
    })
    .from(marketplaceSkills)
    .leftJoin(users, eq(marketplaceSkills.authorId, users.id))
    .where(and(eq(marketplaceSkills.slug, slug), eq(marketplaceSkills.published, true)))
    .limit(1);
  if (!skill) return null;
  return {
    type: 'skill',
    slug: skill.slug,
    name: skill.name,
    authorId: skill.authorId,
    priceCents: skill.priceCents,
    pricingModel: skill.pricingModel,
    sellerTenantId: skill.sellerTenantId ?? null,
  };
}

async function loadPurchasablePersona(db: Db, slug: string): Promise<PurchasableArtifact | null> {
  const [persona] = await db
    .select({
      slug: marketplacePersonas.slug,
      name: marketplacePersonas.name,
      authorId: marketplacePersonas.createdBy,
      sellerTenantId: marketplacePersonas.tenantId,
    })
    .from(marketplacePersonas)
    .where(and(eq(marketplacePersonas.slug, slug), eq(marketplacePersonas.visibility, 'public')))
    .limit(1);
  if (!persona) return null;
  // No price column yet — a public persona records as free. Start refuses $0.
  return {
    type: 'persona',
    slug: persona.slug,
    name: persona.name,
    authorId: persona.authorId,
    priceCents: 0,
    pricingModel: 'flat_fee',
    sellerTenantId: persona.sellerTenantId ?? null,
  };
}

async function loadPurchasableArtifact(
  db: Db,
  artifactType: SkillArtifactType,
  slug: string,
): Promise<PurchasableArtifact | null> {
  return artifactType === 'persona'
    ? loadPurchasablePersona(db, slug)
    : loadPurchasableSkill(db, slug);
}

/**
 * Has this person already bought this skill/persona?
 *
 * USER-scoped: the unique index that makes replay idempotent is the one on
 * `(user_id, artifact_type, artifact_slug) WHERE tenant_id IS NULL`. Filtering
 * on a workspace here would miss every skill purchase that ever happened.
 */
export async function holdsSkillPurchase(
  db: Db,
  userId: string,
  artifactType: SkillArtifactType,
  slug: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: marketplacePurchases.id })
    .from(marketplacePurchases)
    .where(and(
      eq(marketplacePurchases.userId, userId),
      eq(marketplacePurchases.artifactType, artifactType),
      eq(marketplacePurchases.artifactSlug, slug),
      isNull(marketplacePurchases.tenantId),
    ))
    .limit(1);
  return Boolean(row);
}

/**
 * Send a buyer to the processor's hosted page for a priced skill.
 *
 * Grants nothing. Every refusal here is one that would otherwise become a charge
 * for something the buyer already has, cannot use, or published themselves.
 */
export async function startSkillCheckout(
  db: Db,
  env: Env,
  input: {
    buyerUserId: string;
    buyerEmail?: string | null;
    artifactType: SkillArtifactType;
    artifactSlug: string;
    returnUrl: string;
  },
): Promise<{ checkoutUrl: string }> {
  const artifact = await loadPurchasableArtifact(db, input.artifactType, input.artifactSlug);
  if (!artifact) throw new ListingError('Listing not found', 404);
  if (artifact.priceCents <= 0) {
    throw new ListingError(`This ${artifact.type} is free — no checkout is needed`, 400);
  }
  if (artifact.authorId && artifact.authorId === input.buyerUserId) {
    throw new ListingError('You already own what you published', 400);
  }
  if (await holdsSkillPurchase(db, input.buyerUserId, artifact.type, artifact.slug)) {
    throw new ListingError('You already own this', 400);
  }
  if (!env.STRIPE_SECRET_KEY) {
    throw new ListingError('Payments are not configured on this deployment', 400);
  }

  const base = new URL(input.returnUrl);
  const session = await buildPaymentProvider(env).createOneTimeCheckoutSession({
    amountCents: artifact.priceCents,
    currency: 'USD',
    productName: artifact.name,
    billingEmail: input.buyerEmail ?? null,
    // Only the ORIGIN and PATH of the caller's url are kept, so a return url
    // cannot smuggle a query string back through the processor. The artifact is
    // re-attached here, from the row, because the buyer comes back needing to say
    // WHICH purchase to complete and the processor substitutes only the session id.
    successUrl: `${base.origin}${base.pathname}?checkout={CHECKOUT_SESSION_ID}&${artifact.type}=${encodeURIComponent(artifact.slug)}`,
    cancelUrl: `${base.origin}${base.pathname}?checkout=cancelled`,
    metadata: {
      purchaseKind: SKILL_PURCHASE_KIND,
      artifactType: artifact.type,
      artifactSlug: artifact.slug,
      // Carried because the WEBHOOK leg has no session to read it from, and the
      // purchase row records who bought it. The redirect leg has both and agrees.
      buyerUserId: input.buyerUserId,
    },
    idempotencyKey: `mp-checkout:${artifact.type}:${artifact.slug}:${input.buyerUserId}`,
  });
  return { checkoutUrl: session.checkoutUrl };
}

/**
 * Finish a paid skill/persona acquisition.
 *
 * The session id arrives from the buyer's address bar, so everything that
 * authorises the purchase is read back from the processor — including that the
 * person completing it is the person it was created for.
 */
export async function completeSkillCheckout(
  db: Db,
  env: Env,
  input: { buyerUserId: string; checkoutSessionId: string },
): Promise<SkillPurchase> {
  const verified = await verifyPaidCheckout(env, {
    checkoutSessionId: input.checkoutSessionId,
    purchaseKind: SKILL_PURCHASE_KIND,
    owner: { buyerUserId: input.buyerUserId },
    messages: {
      notConfigured: 'Payments are not configured on this deployment',
      notFound: 'That checkout could not be found',
      notPaid: 'That checkout has not been paid',
      wrongKind: 'That checkout was not for a marketplace skill',
      notYours: 'That checkout belongs to someone else',
    },
    refuse,
  });

  const artifactType = verified.metadata.artifactType;
  const artifactSlug = verified.metadata.artifactSlug;
  if (artifactType !== 'skill' && artifactType !== 'persona') {
    throw new ListingError('That checkout names no skill', 400);
  }
  if (!artifactSlug) throw new ListingError('That checkout names no skill', 400);
  const artifact = await loadPurchasableArtifact(db, artifactType, artifactSlug);
  if (!artifact) throw new ListingError('Listing not found', 404);
  // A buyer must not be able to open checkout at the old price and complete it
  // after the owner raised it.
  assertCovers(verified, artifact.priceCents, 'The payment does not cover this listing', refuse);

  return recordSkillPurchase(db, env, {
    buyerUserId: input.buyerUserId,
    artifact,
    priceCents: artifact.priceCents,
    provider: 'stripe',
    externalRef: verified.paymentRef,
  });
}

/**
 * Write the purchase and pay the seller.
 *
 * `onConflictDoNothing` on the user-scoped unique index is what makes a replayed
 * redirect idempotent, and the re-read after it is what lets this still return
 * the purchase rather than nothing when the replay loses that race.
 */
async function recordSkillPurchase(
  db: Db,
  env: Env,
  input: {
    buyerUserId: string;
    artifact: PurchasableArtifact;
    priceCents: number;
    provider: string;
    externalRef: string | null;
  },
): Promise<SkillPurchase> {
  const [inserted] = await db
    .insert(marketplacePurchases)
    .values({
      userId: input.buyerUserId,
      artifactType: input.artifact.type,
      artifactSlug: input.artifact.slug,
      priceCents: input.priceCents,
      pricingModel: input.artifact.pricingModel,
      provider: input.provider,
      externalRef: input.externalRef,
    })
    .onConflictDoNothing()
    .returning({ id: marketplacePurchases.id });

  let purchaseId = inserted?.id ?? null;
  if (purchaseId == null) {
    const [existing] = await db
      .select({ id: marketplacePurchases.id })
      .from(marketplacePurchases)
      .where(and(
        eq(marketplacePurchases.userId, input.buyerUserId),
        eq(marketplacePurchases.artifactType, input.artifact.type),
        eq(marketplacePurchases.artifactSlug, input.artifact.slug),
        isNull(marketplacePurchases.tenantId),
      ))
      .limit(1);
    purchaseId = existing?.id ?? null;
  }
  if (purchaseId == null) throw new ListingError('Could not record the purchase', 400);

  const { commissionCents, sellerCents } = await splitSkillSale(db, env, input.artifact, input.priceCents);
  // Only a sale with an identifiable seller ACCOUNT and TENANT can be credited;
  // a listing whose author has no default workspace still transfers, it just
  // has nobody to pay. Ledger rows require a tenant.
  if (input.priceCents > 0 && input.artifact.authorId && input.artifact.sellerTenantId != null) {
    await creditSkillSeller(db, {
      sellerTenantId: Number(input.artifact.sellerTenantId),
      sellerRef: input.artifact.authorId,
      purchaseId,
      artifactName: input.artifact.name,
      sellerCents,
      commissionCents,
    });
  }

  return {
    purchaseId,
    artifactType: input.artifact.type,
    artifactSlug: input.artifact.slug,
    priceCents: input.priceCents,
    commissionCents,
    sellerCents,
  };
}

/**
 * The platform's cut of this sale.
 *
 * Reuses the marketplace's own threshold rule rather than restating a rate. The
 * seller `ref` is the author's user id because `marketplace_skills` names an
 * author; the lifetime total is therefore the person's, which is also the
 * account the credit below lands in — the two must agree or a seller crosses
 * the threshold in one query and not the other.
 */
async function splitSkillSale(
  db: Db,
  env: Env,
  artifact: { authorId: string | null; sellerTenantId: number | null },
  priceCents: number,
): Promise<{ commissionCents: number; sellerCents: number }> {
  if (priceCents <= 0 || !artifact.authorId || artifact.sellerTenantId == null) {
    return { commissionCents: 0, sellerCents: priceCents };
  }
  const { bps } = await resolveTakeRateBps(db, env, {
    tenantId: Number(artifact.sellerTenantId),
    ref: artifact.authorId,
  });
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
async function creditSkillSeller(db: Db, input: {
  sellerTenantId: number;
  sellerRef: string;
  purchaseId: number;
  artifactName: string;
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
      reference: `mp-sale:${input.purchaseId}`,
      memo: `Skill sale — ${input.artifactName}`,
      metadata: { source: SKILL_PURCHASE_KIND, purchaseId: input.purchaseId },
    },
    {
      tenantId: input.sellerTenantId,
      accountKind: 'partner',
      accountRef: 'platform',
      denomination: USD_CENTS,
      amount: String(input.commissionCents),
      entryKind: 'commission',
      reference: `mp-fee:${input.purchaseId}`,
      memo: `Platform fee — ${input.artifactName}`,
      metadata: { source: SKILL_PURCHASE_KIND, purchaseId: input.purchaseId },
    },
  ]).onConflictDoNothing();
}

/** Re-exported so a route can answer without a second import. */
export { ListingError };
