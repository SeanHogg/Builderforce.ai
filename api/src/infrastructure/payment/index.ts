/**
 * Payment provider factory.
 *
 * Reads PAYMENT_PROVIDER from the Worker environment and returns the
 * appropriate implementation. All current implementations are Stripe-based
 * (or handled manually). Make-or-break transition away from Helcim is complete.
 *
 * PAYMENT_PROVIDER values:
 *   "manual"  — no external processor; subscribe/cancel are local state changes (default)
 *   "stripe"  — Stripe Checkout + Billing (requires STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
 *               STRIPE_PRICE_PRO_MONTHLY, STRIPE_PRICE_PRO_YEARLY,
 *               STRIPE_PRICE_TEAMS_MONTHLY, STRIPE_PRICE_TEAMS_YEARLY)
 *
 * NOTE: The Helcim provider has been removed (FR-01/AC-02). Any Helcim credentials
 * (HELCIM_API_TOKEN, HELCIM_WEBHOOK_SECRET) may be safely removed; they are not consumed.
 *
 * PAYOUTS:
 *   The platform does NOT yet have escrow or automated payouts. For basic on-demand
 *   payouts, the PAYOUT_WEBHOOK_URL binding can be used: a caller may POST to it with
 *   `{ invoiceId, amountCents, currency, freelancerUserId, tenantId }` (Bearer PAYOUT_WEBHOOK_KEY)
 *   and the returned reference can be used to mark the invoice paid. This is not yet subjected
 *   to escrow or minimum-balance constraints. The full escrow engine (FR-06–FR-10) and
 *   automated payout jobs (FR-13, FR-14) are a follow-up scope.
 */

import type { Env } from '../../env';
import type { PaymentProvider } from './PaymentProvider';
import { ManualProvider } from './ManualProvider';
import { StripeProvider } from './StripeProvider';

export { ManualProvider, StripeProvider };
export type { PaymentProvider, CheckoutSessionOpts, CheckoutSessionResult, WebhookEvent } from './PaymentProvider';

export function buildPaymentProvider(env: Env): PaymentProvider {
  const provider = (env.PAYMENT_PROVIDER ?? 'manual').toLowerCase();

  switch (provider) {
    case 'stripe':
      if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) {
        throw new Error('STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are required for PAYMENT_PROVIDER=stripe');
      }
      return new StripeProvider({
        secretKey: env.STRIPE_SECRET_KEY,
        webhookSecret: env.STRIPE_WEBHOOK_SECRET,
        priceProMonthly: env.STRIPE_PRICE_PRO_MONTHLY ?? env.STRIPE_PRICE_MONTHLY ?? '',
        priceProYearly: env.STRIPE_PRICE_PRO_YEARLY ?? env.STRIPE_PRICE_YEARLY ?? '',
        priceTeamsMonthly: env.STRIPE_PRICE_TEAMS_MONTHLY ?? '',
        priceTeamsYearly: env.STRIPE_PRICE_TEAMS_YEARLY ?? '',
      });

    case 'manual':
    default:
      return new ManualProvider();
  }
}