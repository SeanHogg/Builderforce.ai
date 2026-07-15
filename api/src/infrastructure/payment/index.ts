/**
 * Payment provider wiring.
 *
 * Stripe is the ONLY payment processor — there is deliberately no provider switch.
 * The old "manual" fallback activated subscriptions without charging anything, so an
 * unconfigured deploy silently handed paid plans to anyone who typed a card brand into
 * a form. A loud failure is strictly better than that.
 *
 * Required Worker secrets (`wrangler secret put`):
 *   STRIPE_SECRET_KEY           — sk_live_… / sk_test_…
 *   STRIPE_WEBHOOK_SECRET       — whsec_… (from the Stripe dashboard webhook config)
 *   STRIPE_PRICE_PRO_MONTHLY    — price_…  ($29/mo)
 *   STRIPE_PRICE_PRO_YEARLY     — price_…  ($290/yr)
 *   STRIPE_PRICE_TEAMS_MONTHLY  — price_…  ($20/seat/mo)
 *   STRIPE_PRICE_TEAMS_YEARLY   — price_…  ($192/seat/yr)
 *
 * Config is validated LAZILY, not here. This factory runs during Worker boot on every
 * request, so throwing on a missing secret would take the whole API down rather than
 * just billing. Instead {@link StripeProvider} throws {@link PaymentNotConfiguredError}
 * at the point of use, which the routes surface as a 503.
 */

import type { Env } from '../../env';
import type { PaymentProvider } from './PaymentProvider';
import { StripeProvider } from './StripeProvider';

export { StripeProvider };
export { PaymentNotConfiguredError } from './PaymentProvider';
export type {
  PaymentProvider,
  CheckoutSessionOpts,
  CheckoutSessionResult,
  CardValidationSessionOpts,
  CardValidationSessionResult,
  WebhookEvent,
} from './PaymentProvider';

export function buildPaymentProvider(env: Env): PaymentProvider {
  return new StripeProvider({
    secretKey: env.STRIPE_SECRET_KEY ?? '',
    webhookSecret: env.STRIPE_WEBHOOK_SECRET ?? '',
    priceProMonthly: env.STRIPE_PRICE_PRO_MONTHLY ?? env.STRIPE_PRICE_MONTHLY ?? '',
    priceProYearly: env.STRIPE_PRICE_PRO_YEARLY ?? env.STRIPE_PRICE_YEARLY ?? '',
    priceTeamsMonthly: env.STRIPE_PRICE_TEAMS_MONTHLY ?? '',
    priceTeamsYearly: env.STRIPE_PRICE_TEAMS_YEARLY ?? '',
  });
}
