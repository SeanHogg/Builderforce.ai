import { reportCaughtError } from '../../application/observability/caughtErrorReporter';
/**
 * POST /api/webhooks/payment
 *
 * Receives raw webhook payloads from the active payment provider.
 * This route MUST NOT parse the body — signature verification requires the raw bytes.
 * Mounted BEFORE the JSON body-parser middleware in index.ts.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, HonoEnv } from '../../env';
import type { TenantService } from '../../application/tenant/TenantService';
import type { PaymentProvider } from '../../infrastructure/payment/PaymentProvider';
import {
  markCardValidatedByCustomer,
  markCardValidationFailedByCustomer,
} from '../../application/tenant/cardValidationService';
import { markDiscountRedeemed } from '../../application/tenant/discountCodeService';
import { buildDatabase } from '../../infrastructure/database/connection';
import type { Db } from '../../infrastructure/database/connection';
import { recordReferralConversion } from '../../application/sales/recordReferralConversion';
import { recordBusinessPhoneEvent } from '../../application/tenant/businessPhoneSubscription';
import { completeListingCheckout } from '../../application/marketplace/listingCommerce';
import { settleInvoiceCheckout } from '../../application/finance/receivables';
import { completeKnowledgeCheckout } from '../../application/knowledge/knowledgeCommerce';
import { setSubscriptionState } from '../../application/developer/extensionBilling';
import { fireEventTriggers } from '../../application/workflow/eventTriggers';
import { invalidateContainerRunContexts } from '../../application/runtime/cloudAgentEngine';

/**
 * SETTLE A ONE-OFF PURCHASE THAT ARRIVED BY WEBHOOK.
 *
 * Three flows — a creation listing, a knowledge listing and a tenant's own
 * invoice — reach this file for the same reason: the redirect back from the
 * hosted page is the NORMAL way a payment is recorded, and it cannot be the only
 * way, because a buyer who pays and then closes the tab has been charged. Each
 * one was written out longhand with the same three moves, which is three places
 * for the acknowledgement contract to drift.
 *
 * That contract is the part worth stating once:
 *
 *   · INCOMPLETE METADATA is not an error. An event whose signed metadata does
 *     not name everything the settlement needs cannot be settled by retrying it,
 *     so it is acknowledged as unprocessed rather than 500'd into a retry loop.
 *   · A THROW IS ACKNOWLEDGED TOO. The common cause is that the redirect already
 *     recorded this purchase and the settlement is idempotently refusing the
 *     second arrival — which happens about half the time, and is success, not
 *     failure. Returning 500 there would have the processor retry a purchase that
 *     is already complete, forever.
 *   · THE PROCESSOR IS ALWAYS TOLD "received". Nothing here is a reason to make
 *     it redeliver.
 *
 * `complete` returns `null` when the event does not carry what it needs, and
 * otherwise whether the settlement actually applied.
 */
async function settleOneOff(
  c: Context<HonoEnv>,
  spec: {
    /** Names this settlement in the error record. */
    operation: string;
    /** Names it in the log line a human reads. */
    noun: string;
    complete: (db: Db, env: Env) => Promise<boolean | null>;
  },
): Promise<Response> {
  const env = c.env as Env;
  try {
    const applied = await spec.complete(buildDatabase(env), env);
    if (applied === null) {
      console.warn(`[webhook] ${spec.noun} with incomplete metadata; ignoring`);
      return c.json({ received: true, processed: false });
    }
    return c.json({ received: true, processed: applied });
  } catch (err) {
    reportCaughtError(err, {
      source: 'presentation/routes/webhookRoutes.ts',
      operation: spec.operation,
      level: 'warning',
      context: { logMessage: `[webhook] ${spec.noun} did not apply:`, details: err },
    });
    return c.json({ received: true, processed: false });
  }
}

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

    // An `integration` workflow trigger fires on ANY verified provider event that
    // names a tenant — this is the generic "something happened at a connected
    // integration" seam the builder's `integration` trigger addresses by event name
    // (the palette's own example is `invoice.paid`). Fired before the per-type
    // handling below, and best-effort, so a subscriber's workflow can never delay or
    // fail the provider's delivery. `processed` still reflects OUR handling, not the
    // fan-out.
    if (event.tenantId) {
      await fireEventTriggers(buildDatabase(c.env as Env), {
        tenantId: event.tenantId,
        env: c.env as Env,
        eventType: 'integration',
        payload: { provider: 'payment', event: event.type, externalCustomerId: event.externalCustomerId ?? null, billingEmail: event.billingEmail ?? null },
        match: { integrationEvent: event.type },
      }).catch(() => undefined);
    }

    /**
     * A DECLINED CHARGE INVALIDATES THE CARD CLAIM.
     *
     * `subscription.past_due` means the card on file was actually charged and
     * actually declined — the strongest evidence there is that a stored "validated"
     * is no longer true. The plan transition still happens below (this does not
     * short-circuit it): a past-due tenant losing its plan and a past-due tenant
     * losing its PREMIUM unlock are two separate consequences, and only the first
     * was wired. Clearing it here rather than in the provider parser keeps the parser
     * a translator and leaves the policy where the rest of the policy lives.
     *
     * Best-effort — a failure to clear must not fail the webhook, because the plan
     * transition below matters more and the staleness window
     * (`CARD_VALIDATION_MAX_AGE_MS`) is the backstop for anything this misses.
     */
    if (event.type === 'subscription.past_due' && event.externalCustomerId) {
      await markCardValidationFailedByCustomer(c.env as Env, event.externalCustomerId, event.tenantId)
        .catch((err) => {
          reportCaughtError(err, { source: 'presentation/routes/webhookRoutes.ts', operation: 'pastDueCardInvalidation', level: 'warning' });
          return false;
        });
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

          // The card is live NOW — but the container surface caches `premiumEntitled`
          // inside its run context for ten minutes, so without this a tenant who has
          // just paid still can't run premium on that surface until the window
          // expires. A paywall that stays closed after the customer pays is the worst
          // shape a paywall can have. Best-effort: a missed bump costs the remainder
          // of that window, whereas failing here would retry a validation that landed.
          if (outcome.tenantId != null) {
            await invalidateContainerRunContexts(c.env as Env, outcome.tenantId);
          }

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
    /**
     * A MARKETPLACE EXTENSION's subscription changed (PRD 24 §5.4).
     *
     * Addressed by the PROCESSOR's subscription id, which is what the install
     * stored — a workspace can run several paid extensions under one Stripe
     * customer, so the customer cannot identify which one this is about.
     *
     * `past_due` deliberately does NOT stop the extension working: switching
     * somebody's payroll integration off the hour their card expired loses the
     * marketplace both the customer and the vendor, and `subscriptionEntitles`
     * encodes that. What ends the relationship is a cancellation.
     *
     * A `matched` of 0 is a normal outcome and not an error — it means this
     * subscription belongs to something that is not an extension install (or to an
     * install already removed), and the event is acknowledged either way. A
     * webhook that 500s is a webhook the processor retries forever.
     */
    if (
      event.type === 'extension.subscription.activated'
      || event.type === 'extension.subscription.past_due'
      || event.type === 'extension.subscription.cancelled'
    ) {
      const state = event.type === 'extension.subscription.activated' ? 'active'
        : event.type === 'extension.subscription.past_due' ? 'past_due'
          : 'cancelled';
      try {
        const matched = await setSubscriptionState(buildDatabase(c.env), c.env as Env, {
          subscriptionRef: event.externalSubscriptionId,
          state,
        });
        return c.json({ received: true, matched });
      } catch (error) {
        reportCaughtError(error, {
          source: 'presentation/routes/webhookRoutes.ts',
          operation: `extensionSubscription:${state}`,
        });
        return c.json({ received: true, matched: 0 });
      }
    }

    if (event.type === 'listing.purchased') {
      return settleOneOff(c, {
        operation: 'listingPurchase',
        noun: 'listing purchase',
        complete: async (db, env) => {
          if (!event.checkoutSessionId || !event.buyerRef || !event.tenantId) return null;
          await completeListingCheckout(db, env, {
            tenantId: event.tenantId,
            buyerRef: event.buyerRef,
            buyerEmail: event.billingEmail ?? null,
            checkoutSessionId: event.checkoutSessionId,
          });
          return true;
        },
      });
    }

    /**
     * A KNOWLEDGE listing was paid for — the third flow through the same door.
     *
     * Without this, knowledge would be the one paid product on the platform where
     * closing the tab after paying loses the purchase. `completeKnowledgeCheckout`
     * re-reads the session from the processor and lands on the same purchase row
     * the redirect would; the unique index on `(listing, tenant)` makes the second
     * arrival a no-op rather than a second charge.
     */
    if (event.type === 'knowledge.purchased') {
      return settleOneOff(c, {
        operation: 'knowledgePurchase',
        noun: 'knowledge purchase',
        complete: async (db, env) => {
          if (!event.checkoutSessionId || !event.buyerUserId || !event.tenantId) return null;
          await completeKnowledgeCheckout(db, env, {
            tenantId: event.tenantId,
            buyerUserId: event.buyerUserId,
            checkoutSessionId: event.checkoutSessionId,
          });
          return true;
        },
      });
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
      return settleOneOff(c, {
        operation: 'invoicePaid',
        noun: 'invoice payment',
        complete: async (db, env) => {
          if (!event.checkoutSessionId || !event.invoiceRef || !event.tenantId) return null;
          const settled = await settleInvoiceCheckout(db, env, {
            tenantId: event.tenantId,
            invoiceRef: event.invoiceRef,
            checkoutSessionId: event.checkoutSessionId,
          });
          return settled.applied;
        },
      });
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
