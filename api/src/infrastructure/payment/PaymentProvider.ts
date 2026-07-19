/**
 * Payment provider abstraction.
 *
 * Stripe is the only implementation ({@link ../StripeProvider}); this interface exists
 * so the application layer (`TenantService`) depends on a contract rather than on the
 * concrete Stripe client, and so tests can inject a fake. It is NOT a provider-swap
 * seam — there is no provider switch and no manual/no-op fallback.
 *
 * Flow (there is exactly one — every checkout is hosted):
 *   1. Frontend calls POST /api/tenants/:id/subscription/checkout
 *   2. API calls provider.createCheckoutSession() → returns checkoutUrl
 *   3. Frontend redirects the user to the hosted checkout
 *   4. Provider fires a webhook → POST /api/webhooks/payment
 *      → handler calls provider.parseWebhook() → normalised WebhookEvent
 *      → handler calls tenantService.handleWebhookEvent()
 *
 * A subscription is therefore only ever activated by a signed webhook confirming real
 * money moved — never synchronously from user-supplied input.
 */

import { TenantBillingCycle, TenantPlan } from '../../domain/shared/types';

/**
 * Thrown when a payment operation is attempted without the Stripe secrets configured.
 * Deliberately raised at the point of USE rather than at Worker boot: billing being
 * unconfigured must fail the billing routes (503), not the entire API.
 */
export class PaymentNotConfiguredError extends Error {
  readonly code = 'payment_not_configured' as const;
  constructor(missing: string) {
    super(`Payments are not configured: ${missing} is not set on this Worker.`);
    this.name = 'PaymentNotConfiguredError';
  }
}

export interface CheckoutSessionOpts {
  tenantId: number;
  /** Which plan to activate; defaults to PRO if omitted */
  targetPlan?: TenantPlan.PRO | TenantPlan.TEAMS;
  billingCycle: TenantBillingCycle;
  billingEmail: string;
  /** Number of seats — only meaningful for Teams plan */
  seats?: number;
  /** Absolute URL provider redirects to on success */
  successUrl: string;
  /** Absolute URL provider redirects to on cancel */
  cancelUrl: string;
}

export interface CheckoutSessionResult {
  /** Session/transaction ID from the provider (store for audit trail) */
  sessionId: string;
  /** Hosted checkout URL — always redirect the user here. */
  checkoutUrl: string;
  /** Provider-assigned customer ID (available immediately for some providers) */
  externalCustomerId: string | null;
  /** Provider-assigned subscription ID (arrives later via webhook) */
  externalSubscriptionId: string | null;
}

/** Options to start an explicit CARD-VALIDATION session (SetupIntent / $0 auth) —
 *  used to unlock PREMIUM (any-paid-OpenRouter) model selection, which needs a
 *  funding instrument on file even though it's metered per-request, not a plan. */
export interface CardValidationSessionOpts {
  tenantId: number;
  billingEmail: string;
  /** Provider customer id when the tenant already has one (attach the card to it). */
  externalCustomerId?: string | null;
  successUrl: string;
  cancelUrl: string;
}

export interface CardValidationSessionResult {
  sessionId: string;
  /** Hosted URL where the user enters/confirms the card — always redirect here.
   *  Validation completes asynchronously via the `card.validated` webhook. */
  checkoutUrl: string;
  /** Provider-assigned customer id, when created up-front. */
  externalCustomerId: string | null;
}

/**
 * Normalised webhook event — provider-specific payloads are translated into this shape.
 * The webhook route handler calls tenantService methods based on `type`.
 */
export interface WebhookEvent {
  type:
    | 'subscription.activated'   // new subscription created and paid
    | 'subscription.renewed'     // recurring payment succeeded
    | 'subscription.cancelled'   // customer or admin cancelled
    | 'subscription.past_due'    // payment failed, grace period
    | 'payment.succeeded'        // one-off or first payment succeeded
    | 'payment.failed'           // payment declined
    | 'card.validated'           // explicit card-validation (SetupIntent) succeeded
    | 'card.validation_failed';  // explicit card-validation could not complete

  /** Use this to look up the tenant */
  externalCustomerId: string;
  externalSubscriptionId: string;

  /** Present on activation/renewal events */
  billingCycle?: TenantBillingCycle;
  billingEmail?: string;
  /** Which plan is being activated (Teams vs Pro); defaults to Pro if absent */
  targetPlan?: TenantPlan.PRO | TenantPlan.TEAMS;
  /** Number of seats — present on Teams activations */
  seats?: number;
  /** Card details returned by the provider after payment (not entered by user) */
  paymentBrand?: string;
  paymentLast4?: string;
  /** The provider's payment-method id for that card. Persisted so a later
   *  removal/replace can detach exactly this card instead of sweeping the
   *  customer — see migration 0346. */
  paymentMethodId?: string;

  /** Raw provider-specific data for logging/debugging */
  raw: unknown;
}

export interface PaymentProvider {
  /**
   * Create a hosted checkout session for upgrading to Pro/Teams. Returns the
   * `checkoutUrl` to redirect the user to; the plan activates on the resulting webhook.
   * Throws {@link PaymentNotConfiguredError} when the Stripe secrets are absent.
   */
  createCheckoutSession(opts: CheckoutSessionOpts): Promise<CheckoutSessionResult>;

  /**
   * Start an explicit CARD-VALIDATION session (SetupIntent / $0 auth) so the tenant
   * can unlock PREMIUM (any-paid-OpenRouter) model selection. Returns a `checkoutUrl`;
   * validation confirms asynchronously via the `card.validated` webhook.
   * Throws {@link PaymentNotConfiguredError} when the Stripe secrets are absent.
   */
  createCardValidationSession(opts: CardValidationSessionOpts): Promise<CardValidationSessionResult>;

  /** Cancel the active subscription for a tenant (called on downgrade to Free). */
  cancelSubscription(externalSubscriptionId: string): Promise<void>;

  /**
   * Detach a stored CARD so the processor no longer holds it. Called when a tenant
   * removes or replaces their card on file.
   *
   * Prefers `paymentMethodId` — that detaches exactly the card we recorded, which
   * is what a replace needs (revoke the OLD card, keep the new one) and what a
   * multi-card tenant needs. `externalCustomerId` is the fallback for rows
   * validated before migration 0346 stored the id: it sweeps every card on the
   * customer, which is only safe because those tenants have exactly one.
   *
   * The caller must ensure no active subscription depends on the card — detaching
   * one that does would silently break renewal billing.
   *
   * Returns how many were detached (0 is a normal outcome — nothing stored, or the
   * card was already gone). Never throws for "nothing to do".
   */
  detachCards(opts: { paymentMethodId?: string | null; externalCustomerId?: string | null }): Promise<number>;

  /**
   * Parse and validate an inbound webhook payload.
   * Throws if signature verification fails.
   * Returns null for event types this provider doesn't handle.
   */
  parseWebhook(rawBody: string, signatureHeader: string): Promise<WebhookEvent | null>;
}
