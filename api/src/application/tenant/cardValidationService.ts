/**
 * Card-validation state for PREMIUM (any-paid-OpenRouter) model selection.
 *
 * A tenant unlocks the premium tier (select any paid OpenRouter model, billed at
 * OpenRouter cost + a flat 1¢/request) on any plan with a card that has been through
 * an explicit validation flow (Stripe SetupIntent / $0 auth) — see
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
  /** The tenant this validation landed on, so the caller can invalidate what caches
   *  its entitlement (the container run context caches `premiumEntitled` for 10
   *  minutes — without this the freshly validated card doesn't unlock container runs
   *  until that window expires). Null when the customer matched no tenant. */
  tenantId: number | null;
}

/**
 * How long a successful validation is trusted before it must be re-proved.
 *
 * A SetupIntent proves the card was good AT THAT MOMENT. Cards expire — typically
 * within three to four years — and expiry generates no webhook at all: nothing is
 * charged, nothing is detached, the card simply stops working. The event-driven
 * revocations (`payment_method.detached`, a `past_due` subscription,
 * `setup_intent.setup_failed`) cover every case where something HAPPENS; this covers
 * the case where nothing does.
 *
 * Twelve months is chosen to sit well inside a typical card's life while being long
 * enough that no ordinary customer ever meets it: a tenant using premium at all will
 * have had a charge succeed or fail long before, and either outcome refreshes or
 * clears the claim. It is a backstop against a stale unlock, not a re-verification
 * cadence.
 */
export const CARD_VALIDATION_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * A card is "validated" iff it went through the flow (validated_at set + status)
 * AND that validation is still recent enough to mean anything.
 *
 * PURE and time-injectable so the staleness boundary is testable without clock
 * mocking. THE single predicate — the gateway route, the container run context and
 * the premium evaluator all read premium entitlement through it, so a stale unlock
 * cannot survive in one of them and not the others.
 */
export function isCardValidated(
  state: Pick<CardValidationState, 'status' | 'validatedAt'>,
  now: number = Date.now(),
): boolean {
  if (state.status !== 'validated' || state.validatedAt == null) return false;
  return now - state.validatedAt.getTime() < CARD_VALIDATION_MAX_AGE_MS;
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
 * Retained for explicit administrative cleanup. Subscription cancellation does
 * not call this: a Free tenant may keep the card for metered OpenRouter usage.
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
  setup?: { tenantId?: number; billingEmail?: string | null },
): Promise<CardValidatedOutcome> {
  const db = writeDb(env);
  // Read the OUTGOING payment-method id in the same lookup: on a REPLACE this row
  // still holds the previous card, and once we overwrite it the only handle to
  // detach it is gone. Returned to the caller rather than detached here — this
  // module owns our record, not the processor.
  let [row] = await buildDatabase(env)
    .select({ id: tenants.id, previousPaymentMethodId: tenants.externalPaymentMethodId })
    .from(tenants)
    .where(eq(tenants.externalCustomerId, externalCustomerId))
    .limit(1);
  // A Free tenant has never checked out, so it has no external_customer_id yet.
  // The signed tenantId metadata from the setup session is the authoritative
  // first-link; persist the new Stripe Customer as part of the validation write.
  if (!row && setup?.tenantId) {
    [row] = await buildDatabase(env)
      .select({ id: tenants.id, previousPaymentMethodId: tenants.externalPaymentMethodId })
      .from(tenants)
      .where(eq(tenants.id, setup.tenantId))
      .limit(1);
  }
  if (!row) return { known: false, replacedPaymentMethodId: null, tenantId: null };

  await db.update(tenants)
    .set({
      cardValidationStatus: 'validated',
      cardValidatedAt: new Date(),
      ...(card?.brand ? { cardBrand: card.brand } : {}),
      ...(card?.last4 ? { cardLast4: card.last4 } : {}),
      ...(card?.paymentMethodId ? { externalPaymentMethodId: card.paymentMethodId } : {}),
      ...(externalCustomerId ? { externalCustomerId } : {}),
      ...(setup?.billingEmail ? { billingEmail: setup.billingEmail } : {}),
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
  return { known: true, replacedPaymentMethodId: replaced, tenantId: row.id };
}

/** Mark a tenant's card validation as failed (provider rejected the card). */
export async function markCardValidationFailedByCustomer(
  env: Env,
  externalCustomerId: string,
  tenantId?: number,
): Promise<boolean> {
  const db = writeDb(env);
  let [row] = await buildDatabase(env)
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.externalCustomerId, externalCustomerId))
    .limit(1);
  if (!row && tenantId) {
    [row] = await buildDatabase(env)
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
  }
  if (!row) return false;
  await db.update(tenants)
    .set({ cardValidationStatus: 'failed', updatedAt: new Date() })
    .where(eq(tenants.id, row.id));
  return true;
}
