/**
 * Payment provider abstraction.
 *
 * All payment processors (Stripe, Helcim, etc.) implement this interface.
 * The application layer (`TenantService`) depends only on this interface,
 * never on a concrete provider. To swap processors: implement this interface,
 * add the provider to the factory in `index.ts`, and set PAYMENT_PROVIDER env var.
 *
 * Flow:
 *   1. Frontend calls POST /api/tenants/:id/subscription/checkout
 *   2. API calls provider.createCheckoutSession() → returns checkoutUrl
 *   3a. If checkoutUrl: frontend redirects user to hosted checkout
 *       → provider fires webhook → POST /api/webhooks/payment
 *       → handler calls provider.parseWebhook() → normalised WebhookEvent
 *       → handler calls tenantService.activateFromWebhook()
 *   3b. If null (ManualProvider): subscription is immediately active, no redirect
 */

import { TenantBillingCycle, TenantPlan } from '../../domain/shared/types';

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
  /** Redirect the user here if non-null. Null for manual/noop providers. */
  checkoutUrl: string | null;
  /** Provider-assigned customer ID (available immediately for some providers) */
  externalCustomerId: string | null;
  /** Provider-assigned subscription ID (may arrive later via webhook) */
  externalSubscriptionId: string | null;
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
    | 'payment.failed';          // payment declined

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

  /** Raw provider-specific data for logging/debugging */
  raw: unknown;
}

export interface PaymentProvider {
  /** Human-readable provider name (e.g. "manual", "stripe", "helcim") */
  readonly name: string;

  /**
   * Create a checkout session for upgrading to Pro.
   * For hosted providers: returns a `checkoutUrl` to redirect the user to.
   * For the manual provider: activates immediately and returns `checkoutUrl: null`.
   */
  createCheckoutSession(opts: CheckoutSessionOpts): Promise<CheckoutSessionResult>;

  /**
   * Cancel the active subscription for a tenant (called on downgrade to Free).
   * No-op for manual provider.
   */
  cancelSubscription(externalSubscriptionId: string): Promise<void>;

  /**
   * Parse and validate an inbound webhook payload.
   * Throws if signature verification fails.
   * Returns null for event types this provider doesn't handle.
   */
  parseWebhook(rawBody: string, signatureHeader: string): Promise<WebhookEvent | null>;
}
