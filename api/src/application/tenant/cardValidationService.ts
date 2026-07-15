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
        brand: tenants.billingPaymentBrand,
        last4: tenants.billingPaymentLast4,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    return {
      status: (row?.status ?? 'none') as CardValidationStatus,
      validatedAt: row?.validatedAt ?? null,
      brand: row?.brand ?? null,
      last4: row?.last4 ?? null,
    };
  } catch {
    return { status: 'none', validatedAt: null, brand: null, last4: null };
  }
}

/** Mark validation in-flight (SetupIntent created, awaiting provider confirmation). */
export async function markCardPending(env: Env, tenantId: number): Promise<void> {
  const db = writeDb(env);
  await db.update(tenants)
    .set({ cardValidationStatus: 'pending', updatedAt: new Date() })
    .where(eq(tenants.id, tenantId));
}

/** Stamp a tenant's card as validated (provider confirmed a usable card). Also stores
 *  the brand/last4 the provider returned so the UI can show "Visa ••1234". */
export async function markCardValidated(
  env: Env,
  tenantId: number,
  card?: { brand?: string | null; last4?: string | null },
): Promise<void> {
  const db = writeDb(env);
  await db.update(tenants)
    .set({
      cardValidationStatus: 'validated',
      cardValidatedAt: new Date(),
      ...(card?.brand ? { billingPaymentBrand: card.brand } : {}),
      ...(card?.last4 ? { billingPaymentLast4: card.last4 } : {}),
      billingUpdatedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, tenantId));
}

/** Resolve a tenant by the payment provider's external customer id + mark validated.
 *  Used by the webhook path (which keys off external_customer_id). Returns false when
 *  no tenant matches (unknown customer / test event). */
export async function markCardValidatedByCustomer(
  env: Env,
  externalCustomerId: string,
  card?: { brand?: string | null; last4?: string | null },
): Promise<boolean> {
  const db = writeDb(env);
  const [row] = await buildDatabase(env)
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.externalCustomerId, externalCustomerId))
    .limit(1);
  if (!row) return false;
  await db.update(tenants)
    .set({
      cardValidationStatus: 'validated',
      cardValidatedAt: new Date(),
      ...(card?.brand ? { billingPaymentBrand: card.brand } : {}),
      ...(card?.last4 ? { billingPaymentLast4: card.last4 } : {}),
      billingUpdatedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, row.id));
  return true;
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
