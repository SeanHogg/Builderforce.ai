/**
 * StripeProvider — Stripe Checkout + Billing integration.
 *
 * SETUP:
 *   1. Set env vars in wrangler.toml secrets:
 *        STRIPE_SECRET_KEY           — sk_live_... or sk_test_...
 *        STRIPE_WEBHOOK_SECRET       — whsec_... (from Stripe dashboard webhook config)
 *        PAYMENT_PROVIDER            — "stripe"
 *   2. Configure Stripe webhook → https://api.builderforce.ai/api/webhooks/payment
 *      Events: checkout.session.completed, customer.subscription.updated,
 *              customer.subscription.deleted, invoice.payment_failed
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

import type { PaymentProvider, CheckoutSessionOpts, CheckoutSessionResult, WebhookEvent } from './PaymentProvider';
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
  readonly name = 'stripe';

  constructor(private readonly config: StripeConfig) {}

  async createCheckoutSession(opts: CheckoutSessionOpts): Promise<CheckoutSessionResult> {
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

  async cancelSubscription(externalSubscriptionId: string): Promise<void> {
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
    const verified = await verifyStripeSignature(rawBody, signatureHeader, this.config.webhookSecret);
    if (!verified) throw new Error('Invalid Stripe webhook signature');

    const event = JSON.parse(rawBody) as { type: string; data: { object: Record<string, unknown> } };
    const obj = event.data.object;

    switch (event.type) {
      case 'checkout.session.completed': {
        const meta = (obj['metadata'] ?? {}) as Record<string, string>;
        const sub = obj['subscription'] as string | null;
        const customer = obj['customer'] as string;
        const paymentMethodDetails = (obj['payment_method_details'] as Record<string, unknown> | undefined);
        const card = paymentMethodDetails?.['card'] as Record<string, string> | undefined;
        const rawSeats = parseInt(meta['seats'] ?? '1', 10);

        return {
          type: 'subscription.activated',
          externalCustomerId: customer,
          externalSubscriptionId: sub ?? '',
          billingCycle: (meta['billingCycle'] as TenantBillingCycle) ?? TenantBillingCycle.MONTHLY,
          billingEmail: (obj['customer_email'] as string | undefined) ?? meta['billingEmail'],
          targetPlan: (meta['targetPlan'] as TenantPlan.PRO | TenantPlan.TEAMS | undefined) ?? TenantPlan.PRO,
          seats: isNaN(rawSeats) ? 1 : rawSeats,
          paymentBrand: card?.['brand'],
          paymentLast4: card?.['last4'],
          raw: event,
        };
      }

      case 'customer.subscription.updated': {
        const status = obj['status'] as string;
        const customer = obj['customer'] as string;
        const meta = (obj['metadata'] ?? {}) as Record<string, string>;
        return {
          type: status === 'past_due' ? 'subscription.past_due' : 'subscription.renewed',
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

      default:
        return null; // unhandled event type — not an error
    }
  }
}

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
    const parts = Object.fromEntries(
      signatureHeader.split(',').map((p) => p.split('=')),
    ) as Record<string, string>;
    const timestamp = parts['t'];
    const signature = parts['v1'];
    if (!timestamp || !signature) return false;

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

    return hex === signature;
  } catch {
    return false;
  }
}
