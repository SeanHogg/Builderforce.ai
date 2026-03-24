/**
 * Payment provider factory.
 *
 * Reads PAYMENT_PROVIDER from the Worker environment and returns the
 * appropriate implementation. Add new providers here as the business grows.
 *
 * PAYMENT_PROVIDER values:
 *   "manual"  — no external processor; subscribe/cancel are local state changes (default)
 *   "stripe"  — Stripe Checkout + Billing (requires STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
 *               STRIPE_PRICE_PRO_MONTHLY, STRIPE_PRICE_PRO_YEARLY,
 *               STRIPE_PRICE_TEAMS_MONTHLY, STRIPE_PRICE_TEAMS_YEARLY)
 *   "helcim"  — Helcim HelcimPay.js (requires HELCIM_API_TOKEN, HELCIM_WEBHOOK_SECRET)
 */

import type { Env } from '../../env';
import type { PaymentProvider } from './PaymentProvider';
import { ManualProvider } from './ManualProvider';
import { StripeProvider } from './StripeProvider';
import { HelcimProvider } from './HelcimProvider';

export { ManualProvider, StripeProvider, HelcimProvider };
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

    case 'helcim':
      if (!env.HELCIM_API_TOKEN || !env.HELCIM_WEBHOOK_SECRET) {
        throw new Error('HELCIM_API_TOKEN and HELCIM_WEBHOOK_SECRET are required for PAYMENT_PROVIDER=helcim');
      }
      return new HelcimProvider({
        apiToken: env.HELCIM_API_TOKEN,
        webhookSecret: env.HELCIM_WEBHOOK_SECRET,
      });

    case 'manual':
    default:
      return new ManualProvider();
  }
}
