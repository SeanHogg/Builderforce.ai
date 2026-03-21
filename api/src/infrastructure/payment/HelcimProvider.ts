/**
 * HelcimProvider — Helcim HelcimPay.js integration.
 *
 * SETUP:
 *   1. Set env vars in wrangler.toml secrets:
 *        HELCIM_API_TOKEN        — your Helcim API token
 *        HELCIM_WEBHOOK_SECRET   — shared secret configured in Helcim dashboard
 *        PAYMENT_PROVIDER        — "helcim"
 *   2. Configure Helcim webhook to POST to:
 *        https://api.builderforce.ai/api/webhooks/payment
 *
 * BILLING MODEL:
 *   Helcim handles subscriptions differently from Stripe — it uses "recurring
 *   billing schedules" rather than server-side subscriptions. The flow is:
 *     1. Call /payment/initialize to get a checkoutToken
 *     2. Frontend renders HelcimPay.js with the checkoutToken
 *     3. Customer completes payment; Helcim fires a webhook with the transaction
 *     4. Webhook handler activates the subscription
 *
 * DOCS: https://devdocs.helcim.com/reference/post_payment-initialize
 *
 * TODO when implementing:
 *   - Decide whether to use HelcimPay.js (iframe on our page) or redirect to
 *     Helcim-hosted checkout. The current stub uses the hosted approach
 *     (returns a checkoutUrl) to match the Stripe flow.
 *   - Map Helcim's transaction events to WebhookEvent types.
 *   - Implement recurring billing schedule creation for subscriptions.
 */

import type { PaymentProvider, CheckoutSessionOpts, CheckoutSessionResult, WebhookEvent } from './PaymentProvider';

interface HelcimConfig {
  apiToken: string;
  webhookSecret: string;
}

const HELCIM_API_BASE = 'https://api.helcim.com/v2';

export class HelcimProvider implements PaymentProvider {
  readonly name = 'helcim';

  constructor(private readonly config: HelcimConfig) {}

  async createCheckoutSession(opts: CheckoutSessionOpts): Promise<CheckoutSessionResult> {
    const amountCents = opts.billingCycle === 'yearly' ? 29000 : 2900; // $290/yr or $29/mo

    // Initialize a Helcim payment session
    // See: https://devdocs.helcim.com/reference/post_payment-initialize
    const res = await fetch(`${HELCIM_API_BASE}/payment/initialize`, {
      method: 'POST',
      headers: {
        'api-token': this.config.apiToken,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        paymentType: 'purchase',
        amount: amountCents / 100,
        currency: 'USD',
        customerCode: `tenant-${opts.tenantId}`,
        invoiceNumber: `bf-${opts.tenantId}-${Date.now()}`,
        checkoutCustomize: {
          redirectApprovedUrl: opts.successUrl,
          redirectDeclinedUrl: opts.cancelUrl,
        },
        // TODO: attach recurring billing schedule for subscription behaviour
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Helcim initialize error: ${res.status} ${err}`);
    }

    const data = await res.json() as { checkoutToken: string; url?: string };

    // Helcim returns a checkoutToken used with HelcimPay.js.
    // For the redirect flow, construct the hosted checkout URL.
    const checkoutUrl = data.url ?? `https://checkout.helcim.com/${data.checkoutToken}`;

    return {
      sessionId: data.checkoutToken,
      checkoutUrl,
      externalCustomerId: `tenant-${opts.tenantId}`,
      externalSubscriptionId: null, // assigned after payment
    };
  }

  async cancelSubscription(externalSubscriptionId: string): Promise<void> {
    // TODO: implement recurring billing schedule cancellation
    // See: https://devdocs.helcim.com/reference/delete_recurring-billingschedule-id
    console.warn(`[HelcimProvider] cancelSubscription not yet implemented for ${externalSubscriptionId}`);
  }

  async parseWebhook(rawBody: string, signatureHeader: string): Promise<WebhookEvent | null> {
    // Verify HMAC-SHA256 signature
    const verified = await verifyHelcimSignature(rawBody, signatureHeader, this.config.webhookSecret);
    if (!verified) throw new Error('Invalid Helcim webhook signature');

    // TODO: map Helcim webhook payload to WebhookEvent
    // Helcim webhook payload structure differs from Stripe — implement mapping here
    // once Helcim webhook schema is confirmed from their dashboard.
    const payload = JSON.parse(rawBody) as Record<string, unknown>;

    // Placeholder: treat all Helcim webhooks as subscription activation
    // Replace with proper event type mapping based on Helcim's payload
    const transactionStatus = payload['transactionStatus'] as string | undefined;
    if (transactionStatus === 'APPROVED') {
      const cardData = (payload['cardData'] ?? {}) as Record<string, string>;
      return {
        type: 'subscription.activated',
        externalCustomerId: (payload['customerCode'] as string) ?? '',
        externalSubscriptionId: (payload['transactionId'] as string) ?? '',
        billingEmail: (payload['billingEmail'] as string | undefined),
        paymentBrand: cardData['cardType'],
        paymentLast4: cardData['cardNumberLastFour'],
        raw: payload,
      };
    }

    return null;
  }
}

async function verifyHelcimSignature(
  payload: string,
  signatureHeader: string,
  secret: string,
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
    const hex = Array.from(new Uint8Array(mac))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    // Helcim may send the signature with or without a prefix — normalise both
    const incoming = signatureHeader.replace(/^sha256=/, '');
    return hex === incoming;
  } catch {
    return false;
  }
}
