/**
 * Card-validation state for PREMIUM (any-paid-OpenRouter) model selection.
 *
 * A tenant unlocks the premium tier (select any paid OpenRouter model, billed at
 * OpenRouter cost + a flat 1¢/request) only with a PAID plan AND a card that has been
 * through an explicit validation flow (Stripe SetupIntent / $0 auth) — see
 * `evaluatePremiumModelAccess`. This module is the single read/write surface for the
 * `tenants.card_validated_at` + `card_validation_status` columns (migration 0342).
 *
 * Direct-drizzle by design — mirrors `resolveTenantPlan` and `usageLedger`, which also
 * read/write specific `tenants`/ledger columns without routing through the Tenant
 * aggregate. Keeps the validation flow a self-contained concern the gateway gate, the
 * webhook, and the initiation route all share, instead of threading a new field through
 * every Tenant constructor/repository mapping.
 */

import { eq } from 'drizzle-orm';
import type { Env } from '../../env';
import { tenants } from '../../infrastructure/database/schema';
import { buildDatabase, buildTransactionalDatabase } from '../../infrastructure/database/connection';

export type CardValidationStatus = 'none' | 'pending' | 'validated' | 'failed';

export interface CardValidationState {
  status: CardValidationStatus;
  validatedAt: Date | null;
  brand: string | null;
  last4: string | null;
  /** Processor handle for this card (migration 0346). Null for cards validated
   *  before 0346, which fall back to a customer-wide detach. */
  paymentMethodId: string | null;
}

/** Result of the webhook-driven validation write. */
export interface CardValidatedOutcome {
  /** False when no tenant matches the customer (unknown customer / test event). */
  known: boolean;
  /**
   * The payment-method id this validation DISPLACED, when it replaced a different
   * card. The caller detaches it at the processor — doing so only after the new
   * card is confirmed is what makes a replace gap-free. Null on a first-time
   * validation, a re-validation of the same card, or a pre-0346 row.
   */
  replacedPaymentMethodId: string | null;
}

/** A card is "validated" iff it went through the flow (validated_at set + status). */
export function isCardValidated(state: Pick<CardValidationState, 'status' | 'validatedAt'>): boolean {
  return state.status === 'validated' && state.validatedAt != null;
}

function writeDb(env: Env) {
  return env.NEON_TRANSACTIONAL_DATABASE_URL ? buildTransactionalDatabase(env) : buildDatabase(env);
}

/** Read a tenant's current card-validation state (never throws — defaults to none). */
export async function getCardValidation(env: Env, tenantId: number): Promise<CardValidationState> {
  try {
    const db = buildDatabase(env);
    const [row] = await db
      .select({
        status: tenants.cardValidationStatus,
        validatedAt: tenants.cardValidatedAt,
        brand: tenants.cardBrand,
        last4: tenants.cardLast4,
        paymentMethodId: tenants.externalPaymentMethodId,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    return {
      status: (row?.status ?? 'none') as CardValidationStatus,
      validatedAt: row?.validatedAt ?? null,
      brand: row?.brand ?? null,
      last4: row?.last4 ?? null,
      paymentMethodId: row?.paymentMethodId ?? null,
    };
  } catch {
    return { status: 'none', validatedAt: null, brand: null, last4: null, paymentMethodId: null };
  }
}

/** Mark validation in-flight (SetupIntent created, awaiting provider confirmation). */
export async function markCardPending(env: Env, tenantId: number): Promise<void> {
  const db = writeDb(env);
  await db.update(tenants)
    .set({ cardValidationStatus: 'pending', updatedAt: new Date() })
    .where(eq(tenants.id, tenantId));
}

/**
 * Forget a tenant's card entirely — status back to `none`, validation timestamp and
 * the stored brand/last4 cleared.
 *
 * This REVOKES premium-model access (the gate reads `isCardValidated`), which is the
 * point: a tenant removing their card is asking us to stop holding it, and continuing
 * to sell them premium off a card we no longer have would be the bug. Detaching at
 * the processor is the caller's job — this only clears our own record.
 */
export async function clearCardValidation(env: Env, tenantId: number): Promise<void> {
  const db = writeDb(env);
  await db.update(tenants)
    .set({
      cardValidationStatus: 'none',
      cardValidatedAt: null,
      cardBrand: null,
      cardLast4: null,
      externalPaymentMethodId: null,
      // NOT billingUpdatedAt — that timestamp describes the SUBSCRIPTION's payment
      // details, which a card-validation change doesn't touch. `cardValidatedAt`
      // is this flow's own clock.
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, tenantId));
}

/**
 * Clear a tenant's card by the processor's customer id, returning the
 * payment-method id that was on file so the caller can detach it.
 *
 * Used when a subscription ENDS. `DELETE /card-validation` refuses while a paid
 * plan is live (those cards are the renewal instrument), which used to leave a
 * mid-cycle canceller unable to clear their card until the period elapsed — and
 * then only by coming back to do it by hand. Since premium requires a paid plan,
 * a card kept past the subscription serves no purpose we can point at, so it goes
 * with the subscription.
 *
 * Returns null when no tenant matches, or when there was nothing on file.
 */
export async function clearCardValidationByCustomer(
  env: Env,
  externalCustomerId: string,
): Promise<{ known: boolean; clearedPaymentMethodId: string | null }> {
  const [row] = await buildDatabase(env)
    .select({ id: tenants.id, paymentMethodId: tenants.externalPaymentMethodId, status: tenants.cardValidationStatus })
    .from(tenants)
    .where(eq(tenants.externalCustomerId, externalCustomerId))
    .limit(1);
  if (!row) return { known: false, clearedPaymentMethodId: null };
  // Nothing recorded ⇒ nothing to clear or detach; avoid a pointless write.
  if (row.status === 'none' && !row.paymentMethodId) {
    return { known: true, clearedPaymentMethodId: null };
  }
  await clearCardValidation(env, row.id);
  return { known: true, clearedPaymentMethodId: row.paymentMethodId ?? null };
}

/**
 * Resolve a tenant by the payment provider's external customer id + mark validated.
 * Used by the webhook path (which keys off external_customer_id).
 *
 * (A by-tenant-id twin of this existed and had no callers — validation only ever
 * arrives via the webhook — so it was removed rather than left as a second way to
 * write the same columns.)
 */
export async function markCardValidatedByCustomer(
  env: Env,
  externalCustomerId: string,
  card?: { brand?: string | null; last4?: string | null; paymentMethodId?: string | null },
): Promise<CardValidatedOutcome> {
  const db = writeDb(env);
  // Read the OUTGOING payment-method id in the same lookup: on a REPLACE this row
  // still holds the previous card, and once we overwrite it the only handle to
  // detach it is gone. Returned to the caller rather than detached here — this
  // module owns our record, not the processor.
  const [row] = await buildDatabase(env)
    .select({ id: tenants.id, previousPaymentMethodId: tenants.externalPaymentMethodId })
    .from(tenants)
    .where(eq(tenants.externalCustomerId, externalCustomerId))
    .limit(1);
  if (!row) return { known: false, replacedPaymentMethodId: null };

  await db.update(tenants)
    .set({
      cardValidationStatus: 'validated',
      cardValidatedAt: new Date(),
      ...(card?.brand ? { cardBrand: card.brand } : {}),
      ...(card?.last4 ? { cardLast4: card.last4 } : {}),
      ...(card?.paymentMethodId ? { externalPaymentMethodId: card.paymentMethodId } : {}),
      // See clearCardValidation: `billingUpdatedAt` belongs to the subscription.
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, row.id));

  // Only a genuinely DIFFERENT prior card is worth detaching — re-validating the
  // same one must not revoke the card we just confirmed.
  const replaced =
    row.previousPaymentMethodId && row.previousPaymentMethodId !== card?.paymentMethodId
      ? row.previousPaymentMethodId
      : null;
  return { known: true, replacedPaymentMethodId: replaced };
}

/** Mark a tenant's card validation as failed (provider rejected the card). */
export async function markCardValidationFailedByCustomer(env: Env, externalCustomerId: string): Promise<boolean> {
  const db = writeDb(env);
  const [row] = await buildDatabase(env)
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.externalCustomerId, externalCustomerId))
    .limit(1);
  if (!row) return false;
  await db.update(tenants)
    .set({ cardValidationStatus: 'failed', updatedAt: new Date() })
    .where(eq(tenants.id, row.id));
  return true;
}
