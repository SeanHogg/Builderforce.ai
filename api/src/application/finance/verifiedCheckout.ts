/**
 * "Was this checkout really paid, really for this, and really by you?" — the one
 * implementation, shared by every one-off hosted-checkout settlement.
 *
 * A hosted-checkout session id reaches the server in a REDIRECT URL, which is to
 * say it reaches the server from the buyer's address bar. Nothing about it is
 * trustworthy on arrival, so five things have to be read back from the processor
 * before anything is granted:
 *
 *   1. payments are configured at all — otherwise every later check is vacuous;
 *   2. the session exists;
 *   3. it is `paid`;
 *   4. it was for THIS kind of purchase, not some other flow's session;
 *   5. it belongs to the party completing it.
 *
 * The fifth is the one a naive implementation forgets, and forgetting it is not a
 * small bug: one person's paid session then grants to whoever pastes its id.
 * Three separate settlements — a marketplace listing, a tenant invoice and a
 * hosted-app subscription — each wrote those five checks out longhand, and each
 * carried its own comment explaining check five, which is three places for the
 * security-critical one to drift apart. It only has to be missed once.
 *
 * What is NOT shared, deliberately: the refusal TEXT and the error TYPE. A buyer
 * reading "That payment belongs to a different invoice" is being told something
 * more useful than "that checkout belongs to someone else", and each caller
 * already has an error class its routes know how to map to a status. So the
 * machine is shared and the vocabulary is the domain's — the same split
 * `connectedAccounts.ts` draws between the query and each port's view shape.
 */

import type { Env } from '../../env';
import { buildPaymentProvider } from '../../infrastructure/payment';
import type { RetrievedCheckoutSession } from '../../infrastructure/payment';

/**
 * How a caller says "refuse, with this status".
 *
 * Takes the constructor rather than a plain string so the thrown value is the
 * caller's own error class, and its routes keep mapping it to a status exactly as
 * they did when the checks were inline.
 */
export type CheckoutRefusal = (message: string, status: 400 | 403 | 404) => Error;

export interface VerifyCheckoutInput {
  /** The id from the redirect. Untrusted until this function returns. */
  checkoutSessionId: string;
  /** The `purchaseKind` the session must carry — the flow's own name for itself. */
  purchaseKind: string;
  /**
   * Session metadata that must match EXACTLY, or the session is someone else's.
   *
   * Numbers are compared as strings because that is what the processor stores;
   * passing a raw `tenantId` here and having it silently never match was the
   * shape of bug this normalisation removes.
   */
  owner: Record<string, string | number>;
  /** Refusal wording, in this domain's vocabulary. */
  messages: {
    notConfigured: string;
    notFound: string;
    notPaid: string;
    wrongKind: string;
    notYours: string;
  };
  refuse: CheckoutRefusal;
}

export interface VerifiedCheckout {
  /** The processor's own record, for callers that need a field not projected here. */
  session: RetrievedCheckoutSession;
  /**
   * The idempotency reference a settlement should record.
   *
   * Falls back to the session id because a zero-amount or wallet-settled session
   * can carry no payment intent, and a settlement with no reference at all is one
   * a retry cannot recognise as already done.
   */
  paymentRef: string;
  /** What the processor ACTUALLY captured — never what the client said the price was. */
  amountCents: number;
  customerEmail: string | null;
  metadata: Record<string, string>;
}

/**
 * Verify a returned hosted-checkout session, or throw the caller's refusal.
 *
 * Returns only after all five checks pass, so a caller that reaches the next line
 * may grant. It grants nothing itself: what a paid session entitles someone to is
 * the domain's business, and putting it here would make this the second place
 * every entitlement lives.
 */
export async function verifyPaidCheckout(
  env: Env,
  input: VerifyCheckoutInput,
): Promise<VerifiedCheckout> {
  if (!env.STRIPE_SECRET_KEY) throw input.refuse(input.messages.notConfigured, 400);

  const session = await buildPaymentProvider(env).retrieveCheckoutSession(input.checkoutSessionId);
  if (!session) throw input.refuse(input.messages.notFound, 404);
  if (session.paymentStatus !== 'paid') throw input.refuse(input.messages.notPaid, 400);
  if (session.metadata.purchaseKind !== input.purchaseKind) {
    throw input.refuse(input.messages.wrongKind, 400);
  }
  for (const [key, expected] of Object.entries(input.owner)) {
    if (session.metadata[key] !== String(expected)) {
      throw input.refuse(input.messages.notYours, 403);
    }
  }

  return {
    session,
    paymentRef: session.paymentIntentId ?? session.id,
    amountCents: session.amountTotalCents,
    customerEmail: session.customerEmail,
    metadata: session.metadata,
  };
}

/**
 * The price the processor must have covered.
 *
 * Separate from {@link verifyPaidCheckout} because not every settlement has a
 * price to compare against — an invoice settles for whatever it was issued at —
 * but every settlement that DOES must make the comparison, or a buyer can open
 * checkout at the old price and complete it after the seller raised it.
 */
export function assertCovers(
  verified: VerifiedCheckout,
  priceCents: number,
  message: string,
  refuse: CheckoutRefusal,
): void {
  if (verified.amountCents < priceCents) throw refuse(message, 400);
}
