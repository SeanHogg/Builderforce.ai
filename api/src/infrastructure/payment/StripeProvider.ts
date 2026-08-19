/**
 * StripeProvider — Stripe Checkout + Billing integration.
 *
 * The ONLY payment provider — see `./index.ts` for why there is no provider switch.
 *
 * SETUP:
 *   1. Set Worker secrets (`wrangler secret put`):
 *        STRIPE_SECRET_KEY           — sk_live_... or sk_test_...
 *        STRIPE_WEBHOOK_SECRET       — whsec_... (from Stripe dashboard webhook config)
 *   2. Configure Stripe webhook → https://api.builderforce.ai/api/webhooks/payment
 *      Events: checkout.session.completed, customer.subscription.updated,
 *              customer.subscription.deleted, invoice.payment_failed,
 *              setup_intent.setup_failed
 *
 * OPTIONAL PRICE IDs — reusable Stripe Prices are preferred when set:
 *   Pro plan (flat rate):
 *        STRIPE_PRICE_PRO_MONTHLY    — price_...  ($29/mo)
 *        STRIPE_PRICE_PRO_YEARLY     — price_...  ($290/yr)
 *   Teams plan (per-seat):
 *        STRIPE_PRICE_TEAMS_MONTHLY  — price_...  ($20/seat/mo)
 *        STRIPE_PRICE_TEAMS_YEARLY   — price_...  ($192/seat/yr)
 * When an ID is absent, checkout uses inline recurring `price_data` resolved from
 * Builderforce's server-side published pricing contract.
 *
 * NOTE: Uses fetch-based Stripe client — compatible with Cloudflare Workers.
 */

import type {
  BusinessPhoneCheckoutOpts,
  ConnectedAccountStatus,
  InvoicePaymentLinkOpts,
  PaymentProvider,
  CheckoutSessionOpts,
  CheckoutSessionResult,
  CardValidationSessionOpts,
  CardValidationSessionResult,
  WebhookEvent,
} from './PaymentProvider';
import { PaymentNotConfiguredError } from './PaymentProvider';
import { TenantBillingCycle, TenantPlan } from '../../domain/shared/types';

interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  /** Pro plan flat-rate price IDs */
  priceProMonthly: string;
  priceProYearly: string;
  /** Teams plan per-seat price IDs */
  priceTeamsMonthly: string;
  priceTeamsYearly: string;
}

export class StripeProvider implements PaymentProvider {
  constructor(private readonly config: StripeConfig) {}

  /**
   * Fail loudly when a secret is missing, at the point of USE. The factory cannot do
   * this: it runs during Worker boot, so throwing there would 500 every route rather
   * than only billing. Callers map this to a 503.
   */
  private requireConfigured(): void {
    if (!this.config.secretKey) throw new PaymentNotConfiguredError('STRIPE_SECRET_KEY');
  }

  private requireWebhookConfigured(): void {
    if (!this.config.webhookSecret) throw new PaymentNotConfiguredError('STRIPE_WEBHOOK_SECRET');
  }

  async createCheckoutSession(opts: CheckoutSessionOpts): Promise<CheckoutSessionResult> {
    this.requireConfigured();
    const isTeams = opts.targetPlan === TenantPlan.TEAMS;
    const seats = isTeams ? (opts.seats ?? 1) : 1;

    const priceId = (isTeams
      ? (opts.billingCycle === 'yearly' ? this.config.priceTeamsYearly : this.config.priceTeamsMonthly)
      : (opts.billingCycle === 'yearly' ? this.config.priceProYearly : this.config.priceProMonthly)).trim();

    const params = new URLSearchParams({
      mode: 'subscription',
      'line_items[0][quantity]': String(seats),
      customer_email: opts.billingEmail,
      success_url: opts.successUrl,
      cancel_url: opts.cancelUrl,
      'metadata[tenantId]': String(opts.tenantId),
      'metadata[billingCycle]': opts.billingCycle,
      'metadata[targetPlan]': opts.targetPlan ?? TenantPlan.PRO,
      'metadata[seats]': String(seats),
      'subscription_data[metadata][tenantId]': String(opts.tenantId),
      'subscription_data[metadata][targetPlan]': opts.targetPlan ?? TenantPlan.PRO,
      'subscription_data[metadata][seats]': String(seats),
    });

    if (priceId) {
      params.set('line_items[0][price]', priceId);
    } else {
      const currency = opts.currency?.trim().toLowerCase();
      if (!currency || !Number.isInteger(opts.unitAmountCents) || (opts.unitAmountCents ?? 0) <= 0 || !opts.productName?.trim()) {
        throw new PaymentNotConfiguredError(
          isTeams
            ? (opts.billingCycle === 'yearly' ? 'STRIPE_PRICE_TEAMS_YEARLY or published Teams yearly pricing' : 'STRIPE_PRICE_TEAMS_MONTHLY or published Teams monthly pricing')
            : (opts.billingCycle === 'yearly' ? 'STRIPE_PRICE_PRO_YEARLY or published Pro yearly pricing' : 'STRIPE_PRICE_PRO_MONTHLY or published Pro monthly pricing'),
        );
      }
      params.set('line_items[0][price_data][currency]', currency);
      params.set('line_items[0][price_data][unit_amount]', String(opts.unitAmountCents));
      params.set('line_items[0][price_data][recurring][interval]', opts.billingCycle === 'yearly' ? 'year' : 'month');
      params.set('line_items[0][price_data][product_data][name]', opts.productName.trim());
    }

    if (opts.discount) {
      const couponId = await this.ensureDiscountCoupon(opts.discount);
      params.set('discounts[0][coupon]', couponId);
      params.set('metadata[discountRedemptionId]', opts.discount.redemptionId);
      params.set('metadata[discountCode]', opts.discount.code);
      params.set('subscription_data[metadata][discountRedemptionId]', opts.discount.redemptionId);
      params.set('subscription_data[metadata][discountCode]', opts.discount.code);
    }
    if (opts.salesReferralId) {
      params.set('metadata[salesReferralId]', opts.salesReferralId);
      params.set('subscription_data[metadata][salesReferralId]', opts.salesReferralId);
    }

    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!res.ok) {
      const err = await res.json() as { error?: { message?: string } };
      throw new Error(`Stripe checkout error: ${err?.error?.message ?? res.status}`);
    }

    const session = await res.json() as {
      id: string;
      url: string;
      customer: string | null;
    };

    return {
      sessionId: session.id,
      checkoutUrl: session.url,
      externalCustomerId: session.customer ?? null,
      externalSubscriptionId: null, // arrives via webhook after payment
    };
  }

  async createBusinessPhoneCheckoutSession(opts: BusinessPhoneCheckoutOpts): Promise<CheckoutSessionResult> {
    this.requireConfigured();
    const currency = opts.currency.toLowerCase();
    const params = new URLSearchParams({
      mode: 'subscription', customer_email: opts.billingEmail, success_url: opts.successUrl, cancel_url: opts.cancelUrl,
      'line_items[0][quantity]': '1', 'line_items[0][price_data][currency]': currency,
      'line_items[0][price_data][unit_amount]': String(opts.activationCents),
      'line_items[0][price_data][product_data][name]': 'BuilderForce Business Phone activation',
      'line_items[1][quantity]': '1', 'line_items[1][price_data][currency]': currency,
      'line_items[1][price_data][unit_amount]': String(opts.monthlyCents),
      'line_items[1][price_data][recurring][interval]': 'month',
      'line_items[1][price_data][product_data][name]': 'BuilderForce Business Phone',
      'metadata[tenantId]': String(opts.tenantId), 'metadata[purchaseKind]': 'business_phone',
      'metadata[cartId]': opts.cartId,
      'metadata[activationCents]': String(opts.activationCents), 'metadata[monthlyCents]': String(opts.monthlyCents),
      'subscription_data[metadata][tenantId]': String(opts.tenantId),
      'subscription_data[metadata][purchaseKind]': 'business_phone',
      'subscription_data[metadata][cartId]': opts.cartId,
      'subscription_data[metadata][activationCents]': String(opts.activationCents),
      'subscription_data[metadata][monthlyCents]': String(opts.monthlyCents),
    });
    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST', headers: { Authorization: `Bearer ${this.config.secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString(),
    });
    if (!res.ok) {
      const err = await res.json() as { error?: { message?: string } };
      throw new Error(`Stripe business-phone checkout error: ${err.error?.message ?? res.status}`);
    }
    const session = await res.json() as { id: string; url: string; customer: string | null };
    return { sessionId: session.id, checkoutUrl: session.url, externalCustomerId: session.customer ?? null, externalSubscriptionId: null };
  }

  /**
   * A ONE-OFF payment — the marketplace's shape, not a subscription.
   *
   * The two methods above both create recurring sessions; a creation someone
   * bought once is `mode: 'payment'`, and the difference is not cosmetic: a
   * subscription session produces no `payment_status` to verify against and would
   * bill the buyer again next month for a thing they already own.
   *
   * Everything the grant needs is stamped into `metadata`, because the redirect
   * back to our site proves nothing on its own. `retrieveCheckoutSession` reads it
   * back FROM STRIPE, which is the only party that knows whether money moved.
   */
  async createOneTimeCheckoutSession(opts: {
    amountCents: number;
    currency: string;
    productName: string;
    billingEmail?: string | null;
    successUrl: string;
    cancelUrl: string;
    metadata: Record<string, string>;
    /** Same key for the same buyer+listing, so a double-click is one session. */
    idempotencyKey: string;
  }): Promise<{ sessionId: string; checkoutUrl: string }> {
    this.requireConfigured();
    const params = new URLSearchParams({
      mode: 'payment',
      success_url: opts.successUrl,
      cancel_url: opts.cancelUrl,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': opts.currency.toLowerCase(),
      'line_items[0][price_data][unit_amount]': String(opts.amountCents),
      'line_items[0][price_data][product_data][name]': opts.productName.slice(0, 250),
    });
    if (opts.billingEmail) params.set('customer_email', opts.billingEmail);
    for (const [key, value] of Object.entries(opts.metadata)) {
      params.set(`metadata[${key}]`, value);
      params.set(`payment_intent_data[metadata][${key}]`, value);
    }

    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': opts.idempotencyKey,
      },
      body: params.toString(),
    });
    if (!res.ok) {
      const err = await res.json() as { error?: { message?: string } };
      throw new Error(`Stripe checkout error: ${err.error?.message ?? res.status}`);
    }
    const session = await res.json() as { id: string; url: string };
    return { sessionId: session.id, checkoutUrl: session.url };
  }

  /**
   * A RECURRING purchase of somebody else's app.
   *
   * `mode=subscription` with inline `price_data` carrying a `recurring[interval]`
   * — no pre-created Price object, because the seller sets the price on their
   * listing and changes it whenever they like; a Price per listing per change is
   * a catalogue we would then have to reconcile.
   *
   * The metadata is stamped on the SESSION and on the `subscription_data`, so it
   * survives onto the subscription object itself: the renewal invoices arrive
   * months later carrying no session, and without it there is nothing on them
   * saying which app or which subscriber they belong to.
   */
  async createSubscriptionCheckoutSession(opts: {
    amountCents: number;
    currency: string;
    productName: string;
    billingEmail?: string | null;
    interval: 'month' | 'year';
    successUrl: string;
    cancelUrl: string;
    metadata: Record<string, string>;
    idempotencyKey: string;
  }): Promise<{ sessionId: string; checkoutUrl: string }> {
    this.requireConfigured();
    const params = new URLSearchParams({
      mode: 'subscription',
      success_url: opts.successUrl,
      cancel_url: opts.cancelUrl,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': opts.currency.toLowerCase(),
      'line_items[0][price_data][unit_amount]': String(opts.amountCents),
      'line_items[0][price_data][recurring][interval]': opts.interval,
      'line_items[0][price_data][product_data][name]': opts.productName.slice(0, 250),
    });
    if (opts.billingEmail) params.set('customer_email', opts.billingEmail);
    for (const [key, value] of Object.entries(opts.metadata)) {
      params.set(`metadata[${key}]`, value);
      // Carried onto the subscription so a renewal invoice — which arrives with
      // no session id at all — still says what it is for.
      params.set(`subscription_data[metadata][${key}]`, value);
    }

    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': opts.idempotencyKey,
      },
      body: params.toString(),
    });
    if (!res.ok) {
      const err = await res.json() as { error?: { message?: string } };
      throw new Error(`Stripe subscription checkout error: ${err.error?.message ?? res.status}`);
    }
    const session = await res.json() as { id: string; url: string };
    return { sessionId: session.id, checkoutUrl: session.url };
  }

  // ── Connect: the tenant's OWN merchant account (FO-C4) ──────────────────
  //
  // Three calls and one checkout mode. Everything above settles to Builderforce;
  // everything here settles to the TENANT, with the tenant as merchant of record.
  //
  // Deliberately DESTINATION charges rather than direct ones: the session is
  // created on the platform account with `transfer_data[destination]`, so
  // `retrieveCheckoutSession` and the single signed webhook endpoint keep working
  // unchanged. A direct charge would live on the connected account and need a second
  // webhook endpoint with a second secret and a second verification path — three more
  // things to get right for no behaviour the tenant can perceive.

  /** Create a connected account for a tenant. It can take no money until onboarding
   *  completes; `createConnectedAccountLink` is where that happens. */
  async createConnectedAccount(opts: { email?: string | null; country?: string | null; metadata: Record<string, string> }): Promise<{ accountId: string }> {
    this.requireConfigured();
    const params = new URLSearchParams({
      // `standard`: Stripe owns the dashboard for the connected account, which is
      // what makes the TENANT — not us — responsible for their own disputes,
      // refunds and tax reporting. An `express` account would put those on the
      // platform, which is a commitment this product has not made.
      type: 'standard',
      'capabilities[card_payments][requested]': 'true',
      'capabilities[transfers][requested]': 'true',
    });
    if (opts.email) params.set('email', opts.email);
    if (opts.country) params.set('country', opts.country.toUpperCase().slice(0, 2));
    for (const [key, value] of Object.entries(opts.metadata)) params.set(`metadata[${key}]`, value);

    const account = await this.stripePost<{ id: string }>('https://api.stripe.com/v1/accounts', params, 'Stripe connect account error');
    return { accountId: account.id };
  }

  /** A single-use onboarding URL. Short-lived by Stripe's design, which is why it is
   *  never stored: a persisted link is one that has expired by the time it is used. */
  async createConnectedAccountLink(opts: { accountId: string; returnUrl: string; refreshUrl: string }): Promise<{ url: string }> {
    this.requireConfigured();
    const params = new URLSearchParams({
      account: opts.accountId,
      return_url: opts.returnUrl,
      refresh_url: opts.refreshUrl,
      type: 'account_onboarding',
    });
    const link = await this.stripePost<{ url: string }>('https://api.stripe.com/v1/account_links', params, 'Stripe account link error');
    return { url: link.url };
  }

  /** What Stripe says about the account — the only thing that may authorise a link. */
  async connectedAccountStatus(accountId: string): Promise<ConnectedAccountStatus> {
    this.requireConfigured();
    const res = await fetch(`https://api.stripe.com/v1/accounts/${encodeURIComponent(accountId)}`, {
      headers: { Authorization: `Bearer ${this.config.secretKey}` },
    });
    if (!res.ok) {
      const err = await res.json() as { error?: { message?: string } };
      throw new Error(`Stripe connect account read error: ${err.error?.message ?? res.status}`);
    }
    const account = await res.json() as {
      id: string;
      charges_enabled?: boolean;
      payouts_enabled?: boolean;
      details_submitted?: boolean;
      country?: string | null;
      default_currency?: string | null;
      requirements?: { currently_due?: string[] | null; past_due?: string[] | null } | null;
    };
    // `currently_due` and `past_due` overlap; a set keeps the list honest rather than
    // showing the tenant the same outstanding document twice.
    const outstanding = new Set([
      ...(account.requirements?.currently_due ?? []),
      ...(account.requirements?.past_due ?? []),
    ]);
    return {
      accountId: account.id,
      chargesEnabled: account.charges_enabled === true,
      payoutsEnabled: account.payouts_enabled === true,
      detailsSubmitted: account.details_submitted === true,
      country: account.country ?? null,
      defaultCurrency: account.default_currency ? account.default_currency.toUpperCase() : null,
      requirements: [...outstanding],
    };
  }

  /**
   * A hosted page where the TENANT's customer pays the TENANT's invoice.
   *
   * `transfer_data[destination]` sends the money to the tenant; `on_behalf_of` makes
   * them the merchant of record, so the statement descriptor, the settlement currency
   * and the dispute liability are all theirs rather than ours.
   *
   * NO `application_fee_amount`. Builderforce is not a party to a tenant invoicing
   * their own customer, and a silent percentage on somebody else's revenue is not a
   * thing to add without saying so on a pricing page.
   */
  async createInvoicePaymentLink(opts: InvoicePaymentLinkOpts): Promise<{ sessionId: string; checkoutUrl: string }> {
    this.requireConfigured();
    const params = new URLSearchParams({
      mode: 'payment',
      success_url: opts.successUrl,
      cancel_url: opts.cancelUrl,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': opts.currency.toLowerCase(),
      'line_items[0][price_data][unit_amount]': String(opts.amountCents),
      'line_items[0][price_data][product_data][name]': opts.productName.slice(0, 250),
      'payment_intent_data[transfer_data][destination]': opts.merchantAccountId,
      'payment_intent_data[on_behalf_of]': opts.merchantAccountId,
    });
    if (opts.billingEmail) params.set('customer_email', opts.billingEmail);
    for (const [key, value] of Object.entries(opts.metadata)) {
      params.set(`metadata[${key}]`, value);
      params.set(`payment_intent_data[metadata][${key}]`, value);
    }
    const session = await this.stripePost<{ id: string; url: string }>(
      'https://api.stripe.com/v1/checkout/sessions',
      params,
      'Stripe invoice payment link error',
      opts.idempotencyKey,
    );
    return { sessionId: session.id, checkoutUrl: session.url };
  }

  /**
   * ONE form-encoded POST to Stripe.
   *
   * The call sites above each hand-wrote the same fetch, the same two headers, the
   * same `res.ok` check and the same error unwrap. The four Connect calls would have
   * made it eight copies, which is well past the point at which "did we remember to
   * read `error.message`" is a defect waiting rather than a style preference.
   */
  private async stripePost<T>(url: string, params: URLSearchParams, failure: string, idempotencyKey?: string): Promise<T> {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: params.toString(),
    });
    if (!res.ok) {
      const err = await res.json() as { error?: { message?: string } };
      throw new Error(`${failure}: ${err.error?.message ?? res.status}`);
    }
    return await res.json() as T;
  }

  /**
   * Read a checkout session back from Stripe.
   *
   * This is the ONLY thing that may authorise a paid grant. A `session_id` in a
   * redirect URL is a string the buyer's browser handed us and can be edited in
   * the address bar; `payment_status` from Stripe is not.
   */
  async retrieveCheckoutSession(sessionId: string): Promise<{
    id: string;
    paymentStatus: string;
    amountTotalCents: number;
    currency: string;
    paymentIntentId: string | null;
    subscriptionId: string | null;
    customerEmail: string | null;
    metadata: Record<string, string>;
  } | null> {
    this.requireConfigured();
    const res = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
      { headers: { Authorization: `Bearer ${this.config.secretKey}` } },
    );
    if (!res.ok) return null;
    const session = await res.json() as {
      id: string;
      payment_status?: string;
      amount_total?: number;
      currency?: string;
      payment_intent?: string | { id?: string } | null;
      subscription?: string | { id?: string } | null;
      customer_details?: { email?: string | null } | null;
      metadata?: Record<string, string> | null;
    };
    const intent = session.payment_intent;
    // A `mode=subscription` session carries no payment intent — it carries a
    // subscription. Reading only the intent is why a recurring purchase looked
    // unpaid to a caller that had just been told the money moved.
    const subscription = session.subscription;
    return {
      id: session.id,
      paymentStatus: session.payment_status ?? 'unpaid',
      amountTotalCents: session.amount_total ?? 0,
      currency: (session.currency ?? 'usd').toUpperCase(),
      paymentIntentId: typeof intent === 'string' ? intent : intent?.id ?? null,
      subscriptionId: typeof subscription === 'string' ? subscription : subscription?.id ?? null,
      customerEmail: session.customer_details?.email ?? null,
      metadata: session.metadata ?? {},
    };
  }

  private async ensureDiscountCoupon(discount: NonNullable<CheckoutSessionOpts['discount']>): Promise<string> {
    const couponId = `bf_${discount.id.replace(/-/g, '')}_${discount.percentOff}_${discount.durationYears * 12}`;
    const params = new URLSearchParams({
      id: couponId,
      name: `${discount.code} — ${discount.percentOff}% off`,
      percent_off: String(discount.percentOff),
      duration: 'repeating',
      duration_in_months: String(discount.durationYears * 12),
      'metadata[discountCodeId]': discount.id,
    });
    const res = await fetch('https://api.stripe.com/v1/coupons', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': `builderforce-discount-${couponId}`,
      },
      body: params.toString(),
    });
    if (!res.ok) {
      const err = await res.json() as { error?: { code?: string; message?: string } };
      if (err.error?.code !== 'resource_already_exists') {
        throw new Error(`Stripe coupon error: ${err.error?.message ?? res.status}`);
      }
    }
    return couponId;
  }

  async createCardValidationSession(opts: CardValidationSessionOpts): Promise<CardValidationSessionResult> {
    // Stripe Checkout in `setup` mode collects + validates a card (a $0 SetupIntent)
    // without charging — the exact "validate a card on file" flow. On completion Stripe
    // fires `checkout.session.completed` with `mode: 'setup'`, which parseWebhook maps
    // to a `card.validated` event.
    this.requireConfigured();
    const params = new URLSearchParams({
      mode: 'setup',
      // Metered OpenRouter billing needs an actual billing profile, not merely a
      // usable PAN. Stripe Checkout stores the entered name/address on the
      // PaymentMethod and Customer; no subscription is created and no charge is made.
      billing_address_collection: 'required',
      success_url: opts.successUrl,
      cancel_url: opts.cancelUrl,
      'metadata[tenantId]': String(opts.tenantId),
      'metadata[purpose]': 'card_validation',
      'setup_intent_data[metadata][tenantId]': String(opts.tenantId),
    });
    if (opts.externalCustomerId) {
      params.set('customer', opts.externalCustomerId);
      params.set('customer_update[address]', 'auto');
      params.set('customer_update[name]', 'auto');
    } else {
      params.set('customer_email', opts.billingEmail);
      params.set('customer_creation', 'always');
    }

    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    if (!res.ok) {
      const err = await res.json() as { error?: { message?: string } };
      throw new Error(`Stripe card-validation error: ${err?.error?.message ?? res.status}`);
    }
    const session = await res.json() as { id: string; url: string; customer: string | null };
    return {
      sessionId: session.id,
      checkoutUrl: session.url,
      externalCustomerId: session.customer ?? opts.externalCustomerId ?? null,
    };
  }

  /**
   * Detach a stored card.
   *
   * A known `paymentMethodId` is one call and touches exactly that card. Without
   * one (rows validated before migration 0346) we fall back to listing the
   * customer's cards and detaching each — correct for those tenants because they
   * predate multi-card support and hold exactly one.
   *
   * A missing/unknown customer or an empty list is a normal "nothing to do" (0),
   * not an error: the caller's goal is "Stripe no longer holds their card", which
   * is already true in that case.
   */
  async detachCards(opts: { paymentMethodId?: string | null; externalCustomerId?: string | null }): Promise<number> {
    this.requireConfigured();

    if (opts.paymentMethodId) return this.detachOne(opts.paymentMethodId);
    if (!opts.externalCustomerId) return 0;

    const listRes = await fetch(
      `https://api.stripe.com/v1/payment_methods?customer=${encodeURIComponent(opts.externalCustomerId)}&type=card&limit=100`,
      { headers: { Authorization: `Bearer ${this.config.secretKey}` } },
    );
    // A deleted/unknown customer has nothing attached — treat as already-clean
    // rather than failing a removal the user asked for.
    if (listRes.status === 404) return 0;
    if (!listRes.ok) {
      const err = await listRes.json() as { error?: { message?: string } };
      throw new Error(`Stripe payment-method list error: ${err?.error?.message ?? listRes.status}`);
    }
    const { data = [] } = await listRes.json() as { data?: Array<{ id: string }> };

    let detached = 0;
    for (const pm of data) detached += await this.detachOne(pm.id);
    return detached;
  }

  /** Detach one payment method. Returns 1 if WE detached it, 0 if it was already
   *  gone (Stripe 400s on a re-detach — the desired end state either way). */
  private async detachOne(paymentMethodId: string): Promise<number> {
    const res = await fetch(
      `https://api.stripe.com/v1/payment_methods/${encodeURIComponent(paymentMethodId)}/detach`,
      { method: 'POST', headers: { Authorization: `Bearer ${this.config.secretKey}` } },
    );
    if (res.ok) return 1;
    if (res.status === 400 || res.status === 404) return 0;
    const err = await res.json() as { error?: { message?: string } };
    throw new Error(`Stripe detach error: ${err?.error?.message ?? res.status}`);
  }

  async cancelSubscription(externalSubscriptionId: string): Promise<void> {
    this.requireConfigured();
    const res = await fetch(
      `https://api.stripe.com/v1/subscriptions/${externalSubscriptionId}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${this.config.secretKey}` },
      },
    );

    if (!res.ok) {
      const err = await res.json() as { error?: { message?: string } };
      throw new Error(`Stripe cancel error: ${err?.error?.message ?? res.status}`);
    }
  }

  async parseWebhook(rawBody: string, signatureHeader: string): Promise<WebhookEvent | null> {
    // Verify Stripe webhook signature using Web Crypto (Workers-compatible)
    this.requireWebhookConfigured();
    const verified = await verifyStripeSignature(rawBody, signatureHeader, this.config.webhookSecret);
    if (!verified) throw new Error('Invalid Stripe webhook signature');

    const event = JSON.parse(rawBody) as { type: string; data: { object: Record<string, unknown> } };
    const obj = event.data.object;

    switch (event.type) {
      case 'checkout.session.completed': {
        const meta = (obj['metadata'] ?? {}) as Record<string, string>;
        const sub = obj['subscription'] as string | null;
        const customer = obj['customer'] as string;
        const rawTenantId = Number(meta['tenantId']);

        // `setup` mode = the explicit CARD-VALIDATION flow (a $0 SetupIntent), not a
        // subscription purchase. Stripe reuses checkout.session.completed for both, so
        // branch on mode BEFORE the subscription mapping below (a setup session has no
        // subscription and would otherwise activate a plan the tenant never bought).
        if (obj['mode'] === 'setup') {
          const setupIntentId = obj['setup_intent'] as string | null;
          const card = setupIntentId
            ? await this.fetchCard(`https://api.stripe.com/v1/setup_intents/${setupIntentId}?expand[]=payment_method`)
            : undefined;
          return {
            type: 'card.validated',
            externalCustomerId: customer,
            externalSubscriptionId: '',
            ...(Number.isInteger(rawTenantId) && rawTenantId > 0 ? { tenantId: rawTenantId } : {}),
            billingEmail:
              (obj['customer_email'] as string | undefined) ??
              ((obj['customer_details'] as Record<string, string> | undefined)?.['email']),
            ...(card?.brand ? { paymentBrand: card.brand } : {}),
            ...(card?.last4 ? { paymentLast4: card.last4 } : {}),
            // The handle a later remove/replace detaches by (migration 0346).
            ...(card?.id ? { paymentMethodId: card.id } : {}),
            raw: event,
          };
        }

        const customerDetails = obj['customer_details'] as Record<string, string> | undefined;

        // A marketplace purchase is `mode: 'payment'` and has no subscription, so
        // it is branched BEFORE the subscription mapping below — which would
        // otherwise read a plan activation out of a one-off creation sale.
        if (meta['purchaseKind'] === 'marketplace_listing') {
          const buyerTenantId = Number(meta['buyerTenantId']);
          return {
            type: 'listing.purchased',
            purchaseKind: 'marketplace_listing',
            checkoutSessionId: obj['id'] as string,
            buyerRef: meta['buyerRef'],
            ...(Number.isInteger(buyerTenantId) && buyerTenantId > 0 ? { tenantId: buyerTenantId } : {}),
            externalCustomerId: customer ?? '',
            externalSubscriptionId: '',
            billingEmail: (obj['customer_email'] as string | undefined) ?? customerDetails?.['email'],
            raw: event,
          };
        }

        // A TENANT's own invoice, paid by THEIR customer (FO-C4). Branched with the
        // marketplace sale and for the same structural reason: it is `mode: 'payment'`
        // with no subscription, so the plan mapping below would otherwise read a
        // Builderforce plan activation out of somebody else's receivable.
        if (meta['purchaseKind'] === 'tenant_invoice') {
          const sellerTenantId = Number(meta['invoiceTenantId']);
          return {
            type: 'invoice.paid',
            checkoutSessionId: obj['id'] as string,
            invoiceRef: meta['invoiceRef'],
            ...(Number.isInteger(sellerTenantId) && sellerTenantId > 0 ? { tenantId: sellerTenantId } : {}),
            externalCustomerId: customer ?? '',
            externalSubscriptionId: '',
            billingEmail: (obj['customer_email'] as string | undefined) ?? customerDetails?.['email'],
            raw: event,
          };
        }

        if (meta['purchaseKind'] === 'business_phone') {
          return {
            type: 'addon.activated', purchaseKind: 'business_phone',
            activationCents: Number(meta['activationCents']), monthlyCents: Number(meta['monthlyCents']),
            cartId: meta['cartId'],
            ...(Number.isInteger(rawTenantId) && rawTenantId > 0 ? { tenantId: rawTenantId } : {}),
            externalCustomerId: customer, externalSubscriptionId: sub ?? '',
            billingEmail: (obj['customer_email'] as string | undefined) ?? customerDetails?.['email'], raw: event,
          };
        }
        const rawSeats = parseInt(meta['seats'] ?? '1', 10);

        // A Checkout Session carries no card details of its own, so read them off the
        // subscription's payment method.
        const card = sub
          ? await this.fetchCard(
              `https://api.stripe.com/v1/subscriptions/${sub}` +
                '?expand[]=default_payment_method&expand[]=latest_invoice.payment_intent.payment_method',
            )
          : undefined;

        return {
          type: 'subscription.activated',
          ...(Number.isInteger(rawTenantId) && rawTenantId > 0 ? { tenantId: rawTenantId } : {}),
          ...(meta['discountRedemptionId'] ? { discountRedemptionId: meta['discountRedemptionId'] } : {}),
          ...(meta['salesReferralId'] ? { salesReferralId: meta['salesReferralId'] } : {}),
          externalCustomerId: customer,
          externalSubscriptionId: sub ?? '',
          billingCycle: (meta['billingCycle'] as TenantBillingCycle) ?? TenantBillingCycle.MONTHLY,
          billingEmail:
            (obj['customer_email'] as string | undefined) ??
            customerDetails?.['email'] ??
            meta['billingEmail'],
          targetPlan: (meta['targetPlan'] as TenantPlan.PRO | TenantPlan.TEAMS | undefined) ?? TenantPlan.PRO,
          seats: isNaN(rawSeats) ? 1 : rawSeats,
          ...(card?.brand ? { paymentBrand: card.brand } : {}),
          ...(card?.last4 ? { paymentLast4: card.last4 } : {}),
          raw: event,
        };
      }

      case 'customer.subscription.updated': {
        const status = obj['status'] as string;
        const customer = obj['customer'] as string;
        const meta = (obj['metadata'] ?? {}) as Record<string, string>;
        if (meta['purchaseKind'] === 'business_phone') {
          const rawTenantId = Number(meta['tenantId']);
          const addonType = status === 'active' || status === 'trialing' ? 'addon.activated'
            : status === 'past_due' || status === 'unpaid' ? 'addon.past_due'
              : status === 'canceled' ? 'addon.cancelled' : null;
          return addonType ? { type: addonType, purchaseKind: 'business_phone', activationCents: Number(meta['activationCents']), monthlyCents: Number(meta['monthlyCents']), ...(Number.isInteger(rawTenantId) && rawTenantId > 0 ? { tenantId: rawTenantId } : {}), externalCustomerId: customer, externalSubscriptionId: obj['id'] as string, raw: event } : null;
        }

        // Only statuses that carry an actual billing verdict may move the tenant's
        // plan. Anything else (incomplete, paused, …) is acknowledged and ignored —
        // treating them as a renewal would activate a plan that was never paid for.
        const mapped = mapSubscriptionStatus(status);
        if (!mapped) return null;

        return {
          type: mapped,
          externalCustomerId: customer,
          externalSubscriptionId: obj['id'] as string,
          billingCycle: (meta['billingCycle'] as TenantBillingCycle | undefined),
          raw: event,
        };
      }

      case 'customer.subscription.deleted': {
        const meta = (obj['metadata'] ?? {}) as Record<string, string>;
        if (meta['purchaseKind'] === 'business_phone') {
          const rawTenantId = Number(meta['tenantId']);
          return { type: 'addon.cancelled', purchaseKind: 'business_phone', activationCents: Number(meta['activationCents']), monthlyCents: Number(meta['monthlyCents']), ...(Number.isInteger(rawTenantId) && rawTenantId > 0 ? { tenantId: rawTenantId } : {}), externalCustomerId: obj['customer'] as string, externalSubscriptionId: obj['id'] as string, raw: event };
        }
        return {
          type: 'subscription.cancelled',
          externalCustomerId: obj['customer'] as string,
          externalSubscriptionId: obj['id'] as string,
          raw: event,
        };
      }

      case 'invoice.payment_failed': {
        return {
          type: 'payment.failed',
          externalCustomerId: obj['customer'] as string,
          externalSubscriptionId: obj['subscription'] as string ?? '',
          raw: event,
        };
      }

      case 'setup_intent.setup_failed': {
        const meta = (obj['metadata'] ?? {}) as Record<string, string>;
        const rawTenantId = Number(meta['tenantId']);
        return {
          type: 'card.validation_failed',
          externalCustomerId: obj['customer'] as string,
          externalSubscriptionId: '',
          ...(Number.isInteger(rawTenantId) && rawTenantId > 0 ? { tenantId: rawTenantId } : {}),
          raw: event,
        };
      }

      default:
        return null; // unhandled event type — not an error
    }
  }

  /**
   * Best-effort card brand/last4 for display ("Visa ••1234"), given a Stripe URL that
   * expands the payment method. Handles both the SetupIntent shape (`payment_method`)
   * and the Subscription shape (`default_payment_method`, falling back to the latest
   * invoice's payment intent). Returns undefined on any failure — these details are
   * cosmetic and must never fail an otherwise-good webhook, in which case the tenant's
   * existing brand/last4 is left untouched.
   */
  private async fetchCard(url: string): Promise<{ brand?: string; last4?: string; id?: string } | undefined> {
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${this.config.secretKey}` } });
      if (!res.ok) return undefined;
      const body = await res.json() as StripeCardCarrier;
      // Keep the payment METHOD alongside its card details — the method's id is
      // what a later detach needs, and reading it here means the two can't drift.
      const pm =
        body.payment_method ??
        body.default_payment_method ??
        body.latest_invoice?.payment_intent?.payment_method;
      const card = pm?.card;
      if (!card) return undefined;
      return {
        ...(card.brand ? { brand: card.brand } : {}),
        ...(card.last4 ? { last4: card.last4 } : {}),
        ...(pm?.id ? { id: pm.id } : {}),
      };
    } catch {
      return undefined;
    }
  }
}

interface StripePaymentMethod {
  /** The `pm_…` handle a detach targets (migration 0346). Present whenever the
   *  payment method was expanded rather than returned as a bare id string. */
  id?: string;
  card?: { brand?: string; last4?: string } | null;
}

/** The subset of Stripe objects `fetchCard` can pull an expanded card off. */
interface StripeCardCarrier {
  /** SetupIntent */
  payment_method?: StripePaymentMethod | null;
  /** Subscription */
  default_payment_method?: StripePaymentMethod | null;
  /** Subscription fallback, when no default payment method is set */
  latest_invoice?: { payment_intent?: { payment_method?: StripePaymentMethod | null } | null } | null;
}

/**
 * Translate a Stripe subscription status into a billing verdict.
 * Returns null for statuses that must NOT move the tenant's plan either way.
 * See: https://stripe.com/docs/api/subscriptions/object#subscription_object-status
 */
function mapSubscriptionStatus(status: string): WebhookEvent['type'] | null {
  switch (status) {
    case 'active':
    case 'trialing':
      return 'subscription.renewed';
    case 'past_due':
    case 'unpaid':
      return 'subscription.past_due';
    case 'canceled':
      return 'subscription.cancelled';
    // incomplete / incomplete_expired / paused carry no verdict: the customer either
    // hasn't paid yet or is deliberately suspended. `customer.subscription.deleted`
    // handles real terminations.
    default:
      return null;
  }
}

/** Stripe's documented replay window for webhook signatures. */
const SIGNATURE_TOLERANCE_SECONDS = 300;

/**
 * Verify Stripe webhook signature using Web Crypto API (no Node.js required).
 * See: https://stripe.com/docs/webhooks/signatures
 */
async function verifyStripeSignature(
  payload: string,
  signatureHeader: string,
  secret: string,
): Promise<boolean> {
  try {
    // Header form: `t=<ts>,v1=<sig>[,v1=<sig>]`. Multiple v1 entries appear while a
    // signing secret is being rotated, so every one is a candidate.
    let timestamp = '';
    const signatures: string[] = [];
    for (const part of signatureHeader.split(',')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      const key = part.slice(0, eq).trim();
      const value = part.slice(eq + 1).trim();
      if (key === 't') timestamp = value;
      else if (key === 'v1') signatures.push(value);
    }
    if (!timestamp || signatures.length === 0) return false;

    // Without this, a captured payload stays replayable forever.
    const sentAt = Number(timestamp);
    if (!Number.isFinite(sentAt)) return false;
    if (Math.abs(Date.now() / 1000 - sentAt) > SIGNATURE_TOLERANCE_SECONDS) return false;

    const signedPayload = `${timestamp}.${payload}`;
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload));
    const hex = Array.from(new Uint8Array(mac))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    return signatures.some((candidate) => timingSafeEqual(hex, candidate));
  } catch {
    return false;
  }
}

/** Compare without leaking how many leading characters matched via response time. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
