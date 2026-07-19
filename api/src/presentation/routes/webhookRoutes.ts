/**
 * POST /api/webhooks/payment
 *
 * Receives raw webhook payloads from the active payment provider.
 * This route MUST NOT parse the body — signature verification requires the raw bytes.
 * Mounted BEFORE the JSON body-parser middleware in index.ts.
 */

import { Hono } from 'hono';
import type { Env, HonoEnv } from '../../env';
import type { TenantService } from '../../application/tenant/TenantService';
import type { PaymentProvider } from '../../infrastructure/payment/PaymentProvider';
import {
  markCardValidatedByCustomer,
  markCardValidationFailedByCustomer,
  clearCardValidationByCustomer,
} from '../../application/tenant/cardValidationService';

export function createWebhookRoutes(
  tenantService: TenantService,
  paymentProvider: PaymentProvider,
): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  /**
   * POST /payment
   * Provider posts here after checkout completion, renewal, cancellation, etc.
   * Returns 200 quickly — processing happens synchronously but is idempotent.
   */
  router.post('/payment', async (c) => {
    // Read raw body before any JSON parsing
    const rawBody = await c.req.text();
    const signatureHeader =
      c.req.header('Stripe-Signature') ??     // Stripe
      c.req.header('X-Helcim-Signature') ??   // Helcim
      c.req.header('X-Signature') ??           // generic fallback
      '';

    let event;
    try {
      event = await paymentProvider.parseWebhook(rawBody, signatureHeader);
    } catch (err) {
      console.error('[webhook] signature verification failed:', err);
      return c.json({ error: 'Invalid signature' }, 401);
    }

    if (!event) {
      // Provider returned null — unhandled event type, acknowledge without processing
      return c.json({ received: true, processed: false });
    }

    // Card-validation events are NOT subscription state — they only stamp the
    // `card_validated_at` / `card_validation_status` columns that unlock PREMIUM
    // (any-paid-OpenRouter) model selection. Handled here rather than in
    // TenantService so the Tenant aggregate stays about plans/members, matching how
    // `resolveTenantPlan` and the usage ledger already own their own columns.
    if (event.type === 'card.validated' || event.type === 'card.validation_failed') {
      try {
        let known: boolean;
        if (event.type === 'card.validated') {
          const outcome = await markCardValidatedByCustomer(c.env as Env, event.externalCustomerId, {
            brand: event.paymentBrand ?? null,
            last4: event.paymentLast4 ?? null,
            paymentMethodId: event.paymentMethodId ?? null,
          });
          known = outcome.known;

          // A REPLACE completes here: the new card is confirmed and already on the
          // row, so the displaced one can be detached with no gap in premium access
          // (the reverse order would revoke access first and restore it only when
          // this webhook arrived). Best-effort — a failed detach leaves an orphaned
          // card at the processor, which is far better than failing the webhook and
          // having the whole validation retried against an already-updated row.
          if (outcome.replacedPaymentMethodId) {
            try {
              await paymentProvider.detachCards({ paymentMethodId: outcome.replacedPaymentMethodId });
            } catch (detachErr) {
              console.warn('[webhook] replaced card detach failed (orphaned at provider):', detachErr);
            }
          }
        } else {
          known = await markCardValidationFailedByCustomer(c.env as Env, event.externalCustomerId);
        }
        if (!known) {
          console.warn(`[webhook] card event for unknown externalCustomerId: ${event.externalCustomerId}`);
        }
        return c.json({ received: true, processed: known });
      } catch (err) {
        console.error('[webhook] card validation update failed:', err);
        return c.json({ error: 'Processing failed' }, 500);
      }
    }

    try {
      await tenantService.handleWebhookEvent(event);
    } catch (err) {
      console.error('[webhook] handleWebhookEvent failed:', err);
      // Return 500 so the provider retries
      return c.json({ error: 'Processing failed' }, 500);
    }

    // A subscription that has ENDED takes the card with it.
    //
    // `DELETE /card-validation` refuses while a paid plan is live, because those
    // cards bill the renewal — which left a tenant who cancelled mid-cycle unable
    // to clear their card until the period elapsed, and then only by returning to
    // do it by hand. Premium needs a paid plan, so a card kept past the
    // subscription serves no purpose; it is released here instead.
    //
    // Runs AFTER the downgrade so it can't race the plan write, and is
    // best-effort: the subscription change is what the provider is waiting on, and
    // failing the webhook over card cleanup would have it retry a downgrade
    // that already succeeded.
    if (event.type === 'subscription.cancelled') {
      try {
        const { clearedPaymentMethodId } = await clearCardValidationByCustomer(
          c.env as Env,
          event.externalCustomerId,
        );
        if (clearedPaymentMethodId) {
          await paymentProvider.detachCards({ paymentMethodId: clearedPaymentMethodId });
        }
      } catch (err) {
        console.warn('[webhook] card release on subscription end failed:', err);
      }
    }

    return c.json({ received: true, processed: true });
  });

  return router;
}
