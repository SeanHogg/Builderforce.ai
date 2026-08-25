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
  /** Server-resolved published price used when no pre-created provider Price ID exists. */
  currency?: string;
  unitAmountCents?: number;
  productName?: string;
  /** Absolute URL provider redirects to on success */
  successUrl: string;
  /** Absolute URL provider redirects to on cancel */
  cancelUrl: string;
  /** Validated server-side offer. Never accept these values directly from a client. */
  discount?: {
    id: string;
    code: string;
    percentOff: number;
    durationYears: number;
    redemptionId: string;
  };
  /** Pending first-party referral attribution carried in signed provider metadata. */
  salesReferralId?: string;
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

export interface BusinessPhoneCheckoutOpts {
  tenantId: number;
  cartId: string;
  billingEmail: string;
  currency: string;
  activationCents: number;
  monthlyCents: number;
  successUrl: string;
  cancelUrl: string;
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
    | 'card.validation_failed'   // explicit card-validation could not complete
    | 'addon.activated'
    | 'addon.past_due'
    | 'addon.cancelled'
    /**
     * A MARKETPLACE EXTENSION's subscription changed (PRD 24 §5.4).
     *
     * These are separate event types and not the `subscription.*` ones for the
     * same reason `addon.*` are: a tenant's workspace can carry more than one
     * recurring charge, and only ONE of them is the platform plan. An extension
     * subscription arriving as `subscription.cancelled` would cancel the
     * customer's BuilderForce plan because a vendor's card expired — the exact
     * failure the business-phone branch in `parseWebhook` already exists to
     * prevent, applied to the second thing that recurs.
     *
     * They are addressed by `externalSubscriptionId`, which is the identity the
     * install stored, rather than by customer: one workspace can subscribe to
     * several extensions under one Stripe customer.
     */
    | 'extension.subscription.activated'
    | 'extension.subscription.past_due'
    | 'extension.subscription.cancelled'
    /**
     * A marketplace creation was paid for.
     *
     * The REDIRECT is the normal way that grant happens, and this is the reason
     * it cannot be the only way: a buyer who pays and then closes the tab has
     * been charged, and without this event they hold nothing until they think to
     * revisit the link. The handler is idempotent against the redirect path —
     * both end at the same licence, which the unique index makes one.
     */
    | 'listing.purchased'
    /**
     * A TENANT's own invoice was paid by THEIR customer (FO-C4).
     *
     * Same shape of event as `listing.purchased` and for the same reason: the
     * redirect back from the hosted page is the normal way a payment is recorded,
     * and it cannot be the only way — a customer who pays and closes the tab has
     * been charged, and the invoice would sit unpaid until somebody reconciled a
     * bank statement by hand. The handler re-reads the session from the processor
     * and lands on a `ledger_entries` row whose unique reference makes the second
     * arrival a no-op rather than a second payment.
     */
    | 'invoice.paid'
    /**
     * A KNOWLEDGE listing was paid for.
     *
     * Same event, same reason, third flow: a buyer who pays and closes the tab
     * has been charged, and without this they hold nothing. The handler is
     * idempotent against the redirect — both end at the same purchase row, which
     * the unique index on `(listing, tenant)` makes one.
     */
    | 'knowledge.purchased';

  /** Use this to look up the tenant */
  externalCustomerId: string;
  externalSubscriptionId: string;
  /** Signed tenant metadata on card-setup events. This lets a first-time Free
   * tenant be linked to the Customer Stripe creates when Checkout completes. */
  tenantId?: number;

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
  /** Signed Checkout metadata used to finalize a reserved one-time discount. */
  discountRedemptionId?: string;
  /** Signed checkout/subscription metadata identifying the attributed referral. */
  salesReferralId?: string;
  purchaseKind?: 'business_phone' | 'marketplace_listing' | 'knowledge_listing' | 'extension_plan';
  activationCents?: number;
  monthlyCents?: number;
  cartId?: string;
  /** `listing.purchased` — the checkout session to settle, re-read on handling. */
  checkoutSessionId?: string;
  /** `listing.purchased` — who bought it, from the session's signed metadata. */
  buyerRef?: string;
  /** `knowledge.purchased` — the buying USER, from the session's signed metadata. */
  buyerUserId?: string;
  /** `invoice.paid` — which receivable, from the session's signed metadata. */
  invoiceRef?: string;

  /** Raw provider-specific data for logging/debugging */
  raw: unknown;
}

/** A one-off purchase, hosted by the processor. */
export interface OneTimeCheckoutOpts {
  amountCents: number;
  currency: string;
  productName: string;
  billingEmail?: string | null;
  successUrl: string;
  cancelUrl: string;
  /** Stamped on the session AND its payment intent, and read back to authorise. */
  metadata: Record<string, string>;
  /** Same key for the same buyer + item, so a double-click is one session. */
  idempotencyKey: string;
}

/**
 * A RECURRING purchase of somebody else's app, hosted by the processor.
 *
 * Separate from {@link CheckoutSessionOpts} — which is a Builderforce PLAN — for
 * a reason that matters: the payer here is a `site_user`, a person with no
 * Builderforce account, no tenant and no workspace. Reusing the plan path would
 * mean inventing a tenant for a consumer who is deliberately not one.
 *
 * The price is passed as an amount rather than a pre-created provider Price ID
 * because the seller sets it on their listing and changes it when they like; a
 * Price object per listing per change is a catalogue we would have to reconcile.
 */
export interface SubscriptionCheckoutOpts {
  amountCents: number;
  currency: string;
  /** Shown on the processor's page — the app's own name, not ours. */
  productName: string;
  billingEmail?: string | null;
  /** 'month' | 'year'. Monthly is the default a listing offers. */
  interval: 'month' | 'year';
  successUrl: string;
  cancelUrl: string;
  /** Stamped on the session and read back to authorise. Never trusted from a client. */
  metadata: Record<string, string>;
  /** Same key for the same subscriber + listing, so a double-click is one session. */
  idempotencyKey: string;
}

/**
 * A hosted page where a TENANT's customer pays a TENANT's invoice (FO-C4).
 *
 * The distinguishing field is `merchantAccountId`. Every other checkout in this
 * interface settles to Builderforce; this one settles to the tenant's own connected
 * account, with the tenant as merchant of record. The session is still created on the
 * platform account (a destination charge, not a direct one) so that
 * {@link PaymentProvider.retrieveCheckoutSession} and the one signed webhook endpoint
 * keep working unchanged — see `application/finance/merchantAccount.ts` for the whole
 * argument.
 *
 * There is no application fee, deliberately. Builderforce is not a party to a tenant
 * invoicing their own customer.
 */
export interface InvoicePaymentLinkOpts {
  /** The tenant's connected account — money settles here. */
  merchantAccountId: string;
  amountCents: number;
  currency: string;
  /** Shown on the processor's page: the tenant's own invoice reference. */
  productName: string;
  billingEmail?: string | null;
  successUrl: string;
  cancelUrl: string;
  /** Stamped on the session and read back to authorise. Never trusted from a client. */
  metadata: Record<string, string>;
  /** Same key for the same invoice, so re-issuing does not mint a second link. */
  idempotencyKey: string;
}

/**
 * A charge added to a customer's NEXT invoice rather than taken now (PRD 24 §5.4
 * step 4).
 *
 * This is the one operation in this port that does not involve a hosted page,
 * and that is exactly what makes it the Vercel move: the customer picked a plan
 * once, and a month's metered usage of somebody else's extension then appears as
 * a line on the invoice they already receive. Sending them to a checkout page for
 * $4.12 of API calls is the second invoice §2.4 says kills a marketplace.
 *
 * It is an invoice ITEM and not a charge: pending items are swept onto the next
 * invoice the subscription generates, so the platform never holds a card
 * off-session and never has to reconcile a standalone payment against a
 * subscription period.
 *
 * `idempotencyKey` is required, not optional. This is called from a sweep, sweeps
 * retry, and the failure mode of a retried usage charge is billing a customer
 * twice for the same month.
 */
export interface InvoiceItemOpts {
  /** The processor's customer id — `tenants.external_customer_id`. */
  externalCustomerId: string;
  amountCents: number;
  currency: string;
  /** The line as the CUSTOMER reads it. It must name the extension and the units. */
  description: string;
  metadata: Record<string, string>;
  idempotencyKey: string;
}

/** What the processor says about a connected account, as opposed to what our row claims. */
export interface ConnectedAccountStatus {
  accountId: string;
  /** The ONLY field that may authorise minting a payment link. */
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  country: string | null;
  defaultCurrency: string | null;
  /** What is still outstanding, in the processor's own words. */
  requirements: string[];
}

/** What the processor says about a session, as opposed to what a redirect claims. */
export interface RetrievedCheckoutSession {
  id: string;
  /** `'paid'` is the only value that may grant anything. */
  paymentStatus: string;
  amountTotalCents: number;
  currency: string;
  paymentIntentId: string | null;
  /** Present only for a `mode=subscription` session. Reading only the payment
   *  intent is why a recurring purchase looked unpaid to a caller that had just
   *  been told the money moved. */
  subscriptionId: string | null;
  customerEmail: string | null;
  metadata: Record<string, string>;
}

export interface PaymentProvider {
  /**
   * Create a hosted checkout session for upgrading to Pro/Teams. Returns the
   * `checkoutUrl` to redirect the user to; the plan activates on the resulting webhook.
   * Throws {@link PaymentNotConfiguredError} when the Stripe secrets are absent.
   */
  createCheckoutSession(opts: CheckoutSessionOpts): Promise<CheckoutSessionResult>;

  /** Purchase the Business Phone recurring add-on plus its one-time activation. */
  createBusinessPhoneCheckoutSession(opts: BusinessPhoneCheckoutOpts): Promise<CheckoutSessionResult>;

  /**
   * A ONE-OFF hosted payment — a marketplace creation bought once, not a plan.
   * Grants nothing; pair it with {@link retrieveCheckoutSession}.
   */
  createOneTimeCheckoutSession(opts: OneTimeCheckoutOpts): Promise<{ sessionId: string; checkoutUrl: string }>;

  /**
   * A RECURRING hosted payment for access to somebody else's app.
   *
   * Grants nothing on its own; pair it with {@link retrieveCheckoutSession},
   * exactly like the one-time path. The distinction from
   * {@link createCheckoutSession} is the payer: a consumer with no Builderforce
   * account, billed for a creator's product rather than for a platform plan.
   */
  createSubscriptionCheckoutSession(opts: SubscriptionCheckoutOpts): Promise<{ sessionId: string; checkoutUrl: string }>;

  /**
   * Read a checkout session back FROM THE PROCESSOR.
   *
   * The only thing that may authorise a paid grant. A session id reaches us in a
   * redirect URL — i.e. from the buyer's address bar — so the answer to "was this
   * paid, for what, and by whom" has to come from the party that took the money.
   * Returns null when the session does not exist.
   */
  retrieveCheckoutSession(sessionId: string): Promise<RetrievedCheckoutSession | null>;

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
   * Put a charge on the customer's NEXT invoice instead of taking it now.
   *
   * Returns the item's processor id, or `null` when payments are not configured
   * on this deployment — a `null` a caller must record rather than ignore, because
   * the usage it describes was real and somebody still owes for it.
   */
  addInvoiceItem(opts: InvoiceItemOpts): Promise<{ itemId: string } | null>;

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
   * Create a CONNECTED merchant account for a tenant, so they can charge their own
   * customers (FO-C4). Returns the processor's account id; the account cannot take
   * money until onboarding completes — see {@link connectedAccountLink}.
   */
  createConnectedAccount(opts: { email?: string | null; country?: string | null; metadata: Record<string, string> }): Promise<{ accountId: string }>;

  /**
   * A single-use URL where the tenant completes (or resumes) onboarding at the
   * processor. Short-lived by the processor's design, which is why this is a call
   * rather than a stored column: a link persisted in our database would be a link
   * that has expired by the time anybody clicks it.
   */
  createConnectedAccountLink(opts: { accountId: string; returnUrl: string; refreshUrl: string }): Promise<{ url: string }>;

  /**
   * Read a connected account back FROM THE PROCESSOR.
   *
   * The only thing that may authorise minting a payment link. An account can exist,
   * look connected in our own row, and be unable to take a payment because a document
   * is outstanding — which surfaces to the tenant as a customer telling them the link
   * did not work.
   */
  connectedAccountStatus(accountId: string): Promise<ConnectedAccountStatus>;

  /**
   * A hosted page where a tenant's customer pays a tenant's invoice. Grants nothing
   * and marks nothing paid; pair it with {@link retrieveCheckoutSession}, exactly like
   * the listing paths.
   */
  createInvoicePaymentLink(opts: InvoicePaymentLinkOpts): Promise<{ sessionId: string; checkoutUrl: string }>;

  /**
   * Parse and validate an inbound webhook payload.
   * Throws if signature verification fails.
   * Returns null for event types this provider doesn't handle.
   */
  parseWebhook(rawBody: string, signatureHeader: string): Promise<WebhookEvent | null>;
}
