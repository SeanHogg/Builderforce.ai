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
 * PRICE IDs — create recurring prices in Stripe dashboard, then set:
 *   Pro plan (flat rate):
 *        STRIPE_PRICE_PRO_MONTHLY    — price_...  ($29/mo)
 *        STRIPE_PRICE_PRO_YEARLY     — price_...  ($290/yr)
 *   Teams plan (per-seat):
 *        STRIPE_PRICE_TEAMS_MONTHLY  — price_...  ($20/seat/mo)
 *        STRIPE_PRICE_TEAMS_YEARLY   — price_...  ($192/seat/yr)
 *
 * NOTE: Uses fetch-based Stripe client — compatible with Cloudflare Workers.
 */

import type {
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

    const priceId = isTeams
      ? (opts.billingCycle === 'yearly' ? this.config.priceTeamsYearly : this.config.priceTeamsMonthly)
      : (opts.billingCycle === 'yearly' ? this.config.priceProYearly : this.config.priceProMonthly);

    const params = new URLSearchParams({
      mode: 'subscription',
      'line_items[0][price]': priceId,
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

  async createCardValidationSession(opts: CardValidationSessionOpts): Promise<CardValidationSessionResult> {
    // Stripe Checkout in `setup` mode collects + validates a card (a $0 SetupIntent)
    // without charging — the exact "validate a card on file" flow. On completion Stripe
    // fires `checkout.session.completed` with `mode: 'setup'`, which parseWebhook maps
    // to a `card.validated` event.
    this.requireConfigured();
    const params = new URLSearchParams({
      mode: 'setup',
      customer_email: opts.billingEmail,
      success_url: opts.successUrl,
      cancel_url: opts.cancelUrl,
      'metadata[tenantId]': String(opts.tenantId),
      'metadata[purpose]': 'card_validation',
    });
    if (opts.externalCustomerId) params.set('customer', opts.externalCustomerId);

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
            ...(card?.brand ? { paymentBrand: card.brand } : {}),
            ...(card?.last4 ? { paymentLast4: card.last4 } : {}),
            // The handle a later remove/replace detaches by (migration 0346).
            ...(card?.id ? { paymentMethodId: card.id } : {}),
            raw: event,
          };
        }

        const customerDetails = obj['customer_details'] as Record<string, string> | undefined;
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
        return {
          type: 'card.validation_failed',
          externalCustomerId: obj['customer'] as string,
          externalSubscriptionId: '',
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
