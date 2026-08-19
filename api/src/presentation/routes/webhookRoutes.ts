import { reportCaughtError } from '../../application/observability/caughtErrorReporter';
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
} from '../../application/tenant/cardValidationService';
import { markDiscountRedeemed } from '../../application/tenant/discountCodeService';
import { buildDatabase } from '../../infrastructure/database/connection';
import { recordReferralConversion } from '../../application/sales/recordReferralConversion';
import { recordBusinessPhoneEvent } from '../../application/tenant/businessPhoneSubscription';
import { completeListingCheckout } from '../../application/marketplace/listingCommerce';
import { settleInvoiceCheckout } from '../../application/finance/receivables';

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
      reportCaughtError(err, { source: "presentation/routes/webhookRoutes.ts", operation: "createWebhookRoutes", context: { logMessage: '[webhook] signature verification failed:', details: err } });
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
          }, {
            tenantId: event.tenantId,
            billingEmail: event.billingEmail ?? null,
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
              reportCaughtError(detachErr, { source: "presentation/routes/webhookRoutes.ts", operation: "createWebhookRoutes", level: 'warning', context: { logMessage: '[webhook] replaced card detach failed (orphaned at provider):', details: detachErr } });
            }
          }
        } else {
          known = await markCardValidationFailedByCustomer(c.env as Env, event.externalCustomerId, event.tenantId);
        }
        if (!known) {
          console.warn(`[webhook] card event for unknown externalCustomerId: ${event.externalCustomerId}`);
        }
        return c.json({ received: true, processed: known });
      } catch (err) {
        reportCaughtError(err, { source: "presentation/routes/webhookRoutes.ts", operation: "createWebhookRoutes", context: { logMessage: '[webhook] card validation update failed:', details: err } });
        return c.json({ error: 'Processing failed' }, 500);
      }
    }

    /**
     * A marketplace creation was paid for.
     *
     * The redirect back to the listing page is the normal way this grant happens.
     * This is the path for the buyer who paid and then closed the tab — without
     * it they have been charged and hold nothing until they think to revisit the
     * link. Both routes end at `completeListingCheckout`, which re-reads the
     * session from the processor and lands on the same licence; the unique index
     * on `(tenant, catalog item, licensee)` makes the second arrival a no-op
     * rather than a second sale.
     */
    if (event.type === 'listing.purchased') {
      if (!event.checkoutSessionId || !event.buyerRef || !event.tenantId) {
        console.warn('[webhook] listing purchase with incomplete metadata; ignoring');
        return c.json({ received: true, processed: false });
      }
      try {
        await completeListingCheckout(buildDatabase(c.env as Env), c.env as Env, {
          tenantId: event.tenantId,
          buyerRef: event.buyerRef,
          buyerEmail: event.billingEmail ?? null,
          checkoutSessionId: event.checkoutSessionId,
        });
        return c.json({ received: true, processed: true });
      } catch (err) {
        // A buyer who already collected via the redirect is the COMMON case here,
        // not a fault: the grant is idempotent and this arrives second about half
        // the time. Acknowledge so the processor stops retrying, and record it.
        reportCaughtError(err, {
          source: 'presentation/routes/webhookRoutes.ts',
          operation: 'listingPurchase',
          level: 'warning',
          context: { logMessage: '[webhook] listing grant did not apply:', details: err },
        });
        return c.json({ received: true, processed: false });
      }
    }

    /**
     * A TENANT's own invoice was paid by THEIR customer (FO-C4).
     *
     * The redirect back to the invoice page is the normal way this is recorded,
     * and this is the path for the customer who paid and then closed the tab —
     * without it they have been charged and the invoice stays open until somebody
     * reconciles a bank statement by hand. Both routes end at
     * `settleInvoiceCheckout`, which re-reads the session from the processor and
     * lands on one `ledger_entries` row; the unique reference makes the second
     * arrival a no-op rather than a second payment.
     */
    if (event.type === 'invoice.paid') {
      if (!event.checkoutSessionId || !event.invoiceRef || !event.tenantId) {
        console.warn('[webhook] invoice payment with incomplete metadata; ignoring');
        return c.json({ received: true, processed: false });
      }
      try {
        const settled = await settleInvoiceCheckout(buildDatabase(c.env as Env), c.env as Env, {
          tenantId: event.tenantId,
          invoiceRef: event.invoiceRef,
          checkoutSessionId: event.checkoutSessionId,
        });
        return c.json({ received: true, processed: settled.applied });
      } catch (err) {
        // A payment the redirect already recorded is the COMMON case here, not a
        // fault — and `applied: false` is the answer for that one, so anything
        // reaching this branch is a genuine problem. Acknowledge anyway so the
        // processor stops retrying, and record it.
        reportCaughtError(err, {
          source: 'presentation/routes/webhookRoutes.ts',
          operation: 'invoicePaid',
          level: 'warning',
          context: { logMessage: '[webhook] invoice payment did not apply:', details: err },
        });
        return c.json({ received: true, processed: false });
      }
    }

    try {
      if (event.purchaseKind === 'business_phone') {
        await recordBusinessPhoneEvent(buildDatabase(c.env as Env), event);
        return c.json({ received: true, processed: true });
      }
      await tenantService.handleWebhookEvent(event);
      await recordReferralConversion(buildDatabase(c.env as Env), c.env as Env, event);
      if (event.type === 'subscription.activated' && event.discountRedemptionId) {
        if (!event.tenantId) throw new Error('Discount activation webhook is missing signed tenant metadata');
        await markDiscountRedeemed(buildDatabase(c.env as Env), event.tenantId, event.discountRedemptionId);
      }
    } catch (err) {
      reportCaughtError(err, { source: "presentation/routes/webhookRoutes.ts", operation: "createWebhookRoutes", context: { logMessage: '[webhook] handleWebhookEvent failed:', details: err } });
      // Return 500 so the provider retries
      return c.json({ error: 'Processing failed' }, 500);
    }

    // Cancelling a subscription does NOT remove the card-validation profile.
    // Free tenants can keep it for metered OpenRouter usage and may remove it
    // explicitly from /pricing once the subscription is no longer active.

    return c.json({ received: true, processed: true });
  });

  return router;
}
