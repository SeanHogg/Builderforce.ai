/**
 * BUYING COMMUNICATIONS CREDIT — the only door that puts money in the balance.
 *
 * ── WHY THE OLD SHAPE WAS NOT A TOP-UP ───────────────────────────────────────
 * The first cut of `POST /api/phone/topup` took `{ cents, reference }` and
 * credited the balance. It was owner-gated and idempotent, and it was still an
 * endpoint that CREATES MONEY on request: the `reference` it trusted for
 * idempotency was supplied by the caller, and nothing anywhere verified that a
 * payment had happened. It was written as the settlement half of a flow whose
 * paying half did not exist yet, which is exactly the seam that gets shipped and
 * then discovered from the outside.
 *
 * So the flow is the platform's standard one-off purchase, unchanged:
 *
 *   1. {@link startCommsTopUp} opens a hosted checkout for a fixed pack and
 *      stamps the tenant and the pack into the session metadata.
 *   2. The processor takes the money.
 *   3. {@link completeCommsTopUp} reads the session BACK FROM THE PROCESSOR via
 *      `verifyPaidCheckout` — the shared five-check primitive, including the one
 *      that matters most here: that the session belongs to this tenant and not to
 *      whoever pasted its id — and only then credits the ledger.
 *
 * The credit is keyed on the payment intent, so the redirect and a webhook retry
 * land on one row.
 *
 * ── WHY PACKS AND NOT AN AMOUNT FIELD ────────────────────────────────────────
 * A free-text amount is a price the buyer sets. Fixed packs mean the value being
 * charged is one of a handful this platform published, which makes
 * `assertCovers` a real check rather than a comparison against whatever the
 * client asked for.
 */

import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { buildPaymentProvider } from '../../infrastructure/payment';
import { verifyPaidCheckout, assertCovers } from '../finance/verifiedCheckout';
import { commsBalance, topUpComms } from './commsBalance';

/** The `purchaseKind` stamped on the session — this flow's name for itself, and
 *  what stops another flow's paid session being redeemed as phone credit. */
export const COMMS_TOPUP_KIND = 'comms_topup';

export interface CommsTopUpPack {
  id: string;
  /** US cents charged AND US cents of credit granted — one to one, deliberately.
   *  A "bonus credit" tier would make the balance mean something other than the
   *  money behind it, and the ledger's whole job is that they agree. */
  cents: number;
}

export const COMMS_TOPUP_PACKS: readonly CommsTopUpPack[] = [
  { id: 'comms-10', cents: 1000 },
  { id: 'comms-25', cents: 2500 },
  { id: 'comms-50', cents: 5000 },
];

export function topUpPack(id: string): CommsTopUpPack | null {
  return COMMS_TOPUP_PACKS.find((pack) => pack.id === id) ?? null;
}

/** The caller's refusal vocabulary, mapped to a status by the route. */
export class CommsTopUpError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404) {
    super(message);
    this.name = 'CommsTopUpError';
  }
}

const refuse = (message: string, status: 400 | 403 | 404) => new CommsTopUpError(message, status);

export async function startCommsTopUp(
  env: Env,
  input: {
    tenantId: number; userId: string; packId: string;
    billingEmail?: string | null; appUrl: string;
  },
): Promise<{ checkoutUrl: string; sessionId: string }> {
  const pack = topUpPack(input.packId);
  if (!pack) throw refuse('That communications credit pack does not exist', 400);
  if (!env.STRIPE_SECRET_KEY) throw refuse('Payments are not configured', 400);

  return buildPaymentProvider(env).createOneTimeCheckoutSession({
    amountCents: pack.cents,
    currency: 'USD',
    productName: `Communications credit — $${(pack.cents / 100).toFixed(2)}`,
    billingEmail: input.billingEmail ?? null,
    // The CONSOLE, not the shop. `/crm/phone` renders the public marketing shell
    // (it is in `PUBLIC_SHELL_PREFIXES`), so returning a paying operator there
    // would drop them out of the app chrome onto a page trying to sell them the
    // thing they just bought more of.
    successUrl: `${input.appUrl}/inbox?tab=phone&topup={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${input.appUrl}/inbox?tab=phone&topup=cancelled`,
    metadata: {
      purchaseKind: COMMS_TOPUP_KIND,
      tenantId: String(input.tenantId),
      packId: pack.id,
      cents: String(pack.cents),
    },
    // Same tenant + same pack + same day = one session, so a double-click does
    // not open two checkouts the buyer could pay twice.
    idempotencyKey: `comms:${input.tenantId}:${pack.id}:${new Date().toISOString().slice(0, 10)}`,
  });
}

export async function completeCommsTopUp(
  db: Db, env: Env,
  input: { tenantId: number; checkoutSessionId: string },
): Promise<{ applied: boolean; balanceCents: number; creditedCents: number }> {
  const verified = await verifyPaidCheckout(env, {
    checkoutSessionId: input.checkoutSessionId,
    purchaseKind: COMMS_TOPUP_KIND,
    // The check that stops one workspace's paid session crediting another's balance.
    owner: { tenantId: input.tenantId },
    messages: {
      notConfigured: 'Payments are not configured',
      notFound: 'That payment could not be found',
      notPaid: 'That payment has not completed',
      wrongKind: 'That payment was not for communications credit',
      notYours: 'That payment belongs to a different workspace',
    },
    refuse,
  });

  const pack = topUpPack(verified.metadata.packId ?? '');
  if (!pack) throw refuse('That communications credit pack no longer exists', 400);
  // What the processor actually captured has to cover the pack — otherwise a
  // buyer can open checkout at one price and complete it after it changed.
  assertCovers(verified, pack.cents, 'That payment did not cover the credit pack', refuse);

  const applied = await topUpComms(db, env, {
    tenantId: input.tenantId,
    cents: pack.cents,
    reference: `phone:topup:${verified.paymentRef}`,
    memo: `Communications credit — $${(pack.cents / 100).toFixed(2)}`,
    metadata: { packId: pack.id, paymentRef: verified.paymentRef, kind: 'topup' },
  });

  return {
    applied,
    creditedCents: pack.cents,
    balanceCents: await commsBalance(db, env, input.tenantId),
  };
}
