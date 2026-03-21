/**
 * ManualProvider — the default, no-op payment provider.
 *
 * Preserves the current behaviour exactly:
 *  - No external payment processor is contacted
 *  - Subscription activates immediately on upgrade
 *  - No redirect URL is returned (the frontend stays on the pricing page)
 *  - Downgrade is a local state change with no external call
 *  - Webhooks are never sent (returns null on parse)
 *
 * Use this when:
 *  - Running in development/staging without payment credentials
 *  - Operating a manual invoicing workflow
 *  - PAYMENT_PROVIDER env var is unset or set to "manual"
 */

import type { PaymentProvider, CheckoutSessionOpts, CheckoutSessionResult, WebhookEvent } from './PaymentProvider';

export class ManualProvider implements PaymentProvider {
  readonly name = 'manual';

  async createCheckoutSession(
    _opts: CheckoutSessionOpts,
  ): Promise<CheckoutSessionResult> {
    // No external call — subscription will be activated synchronously by TenantService
    return {
      sessionId: `manual-${Date.now()}`,
      checkoutUrl: null,
      externalCustomerId: null,
      externalSubscriptionId: null,
    };
  }

  async cancelSubscription(_externalSubscriptionId: string): Promise<void> {
    // Nothing to cancel externally
  }

  async parseWebhook(_rawBody: string, _signatureHeader: string): Promise<WebhookEvent | null> {
    // Manual provider never receives webhooks
    return null;
  }
}
