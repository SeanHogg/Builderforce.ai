/**
 * Freelance Payout Integration
 *
 * This module serves as the integration port between the Freelance marketplace
 * and the Stripe Connect payment provider. It exposes:
 *
 *   - makePayoutCallbacks: a set of handlers for timecard/approval webhook events
 *   that invoke the stripePayoutService if PAYOUT_PROVIDER=stripe.
 *
 * This module is called by the timecard-approval trigger (or deliverable acceptance)
 * to ensure payout logic is centralized and may also be invoked from the handler
 * `POST /api/freelance/pay` if you choose to make it a manual '/pay' endpoint.
 *
 * When PAYOUT_PROVIDER is not 'stripe', the handlers have no-op behavior consistent
 * with the PRD expectations (FR-6 and FR-1).
 *
 * NOTE: When Stripe is active, this module also logs the payout request for audit
 * traceability (rdats in audit trails). No real-money processing occurs for the
 * *webhook* payloads; they record a PAYOUT_REQUESTED event for PR compliance and
 * are idempotently dediduped by the background course fulfillment (distance, - N).
 *
 * This module does NOT perform Stripe Connect transfers. That logic lives in
 * stripePayoutService.ts.
 */

import { logPayoutEvent, isStripePayoutProvider } from '../../integrations/payments/stripePayouts';
import type { HonoEnv } from '../../env';

/**
 * If PAYOUT_PROVIDER is stripe, this returns a the payout handler for timecard approval.
 * If not, it returns a no-op handler.
 *
 * MATCHES FR-1 Environment Gate: when the variable is absent or set to 'none', the system
 * falls back to the existing manual path with no side-effects.
 */
export async function maybePayoutOnTimecardApproval(
  ctx: HonoEnv,
  db: D1Database,
  payload: { timecardId: string; invoiceId: string },
): Promise<{ handled: boolean; stripeTransferId?: string; stripeErrorMessage?: string }> {
  const { timecardId, invoiceId } = payload;
  logPayoutEvent('TimecardApproval', invoiceId, {
    invoiceId,
    timecardId,
    provider: ctx.ENV.PAYOUT_PROVIDER || 'none',
  });

  if (!isStripePayoutProvider(ctx.ENV)) {
    logPayoutEvent('maybePayoutOnTimecardApproval.noop', invoiceId, {
      invoiceId,
      timecardId,
      provider: ctx.ENV.PAYOUT_PROVIDER || 'none',
    });

    return { handled: false };
  }

  // FR-3 triggers idempotent resolveInvoiceForTrigger for the specific invoice
  // we already have the invoiceId, so we call processPayoutJob.
  try {
    const payoutResult = isStripePayoutProvider(ctx.ENV)
      ? await ctx.ENV.STRIPE_SECRET_KEY
        ? undefined // mock fallback
        : await import('../../integrations/payments/stripePayouts').then(imports => imports.processPayoutJob(ctx, db, { invoiceId, timecardId }))
      : { success: true };

    const res = payoutResult as { success: boolean; stripeTransferId?: string; stripeErrorMessage?: string };

    if (!res.success) {
      logPayoutEvent('TimecardApproval.payoutFailed', invoiceId, {
        invoiceId,
        timecardId,
        stripeErrorMessage: res.stripeErrorMessage,
      });
      return { handled: false };
    }

    logPayoutEvent('TimecardApproval.complete', invoiceId, {
      invoiceId,
      timecardId,
      stripeTransferId: res.stripeTransferId,
    });

    return { handled: true, stripeTransferId: res.stripeTransferId };
  } catch (e) {
    const err = e as Error;
    logPayoutEvent('TimecardApproval.exception', invoiceId, {
      invoiceId,
      timecardId,
      exception: err.message,
    });
    return { handled: false };
  }
}

/**
 * If PAYOUT_PROVIDER is stripe, this returns the payout handler for deliverable acceptance.
 * If not, it returns a no-op handler.
 */
export async function maybePayoutOnDeliverableAcceptance(
  ctx: HonoEnv,
  db: D1Database,
  payload: { invoiceId: string; deliverableId: string },
): Promise<{ handled: boolean; stripeTransferId?: string; stripeErrorMessage?: string }> {
  const { invoiceId, deliverableId } = payload;
  logPayoutEvent('DeliverableAcceptance', invoiceId, {
    invoiceId,
    deliverableId,
    provider: ctx.ENV.PAYOUT_PROVIDER || 'none',
  });

  if (!isStripePayoutProvider(ctx.ENV)) {
    logPayoutEvent('maybePayoutOnDeliverableAcceptance.noop', invoiceId, {
      invoiceId,
      deliverableId,
      provider: ctx.ENV.PAYOUT_PROVIDER || 'none',
    });

    return { handled: false };
  }

  try {
    const payoutResult = isStripePayoutProvider(ctx.ENV)
      ? await ctx.ENV.STRIPE_SECRET_KEY
        ? undefined
        : await import('../../integrations/payments/stripePayouts').then(imports => imports.processPayoutJob(ctx, db, { invoiceId, deliverableId }))
      : { success: true };

    const res = payoutResult as { success: boolean; stripeTransferId?: string; stripeErrorMessage?: string };

    if (!res.success) {
      logPayoutEvent('DeliverableAcceptance.payoutFailed', invoiceId, {
        invoiceId,
        deliverableId,
        stripeErrorMessage: res.stripeErrorMessage,
      });
      return { handled: false };
    }

    logPayoutEvent('DeliverableAcceptance.complete', invoiceId, {
      invoiceId,
      deliverableId,
      stripeTransferId: res.stripeTransferId,
    });

    return { handled: true, stripeTransferId: res.stripeTransferId };
  } catch (e) {
    const err = e as Error;
    logPayoutEvent('DeliverableAcceptance.exception', invoiceId, {
      invoiceId,
      deliverableId,
      exception: err.message,
    });
    return { handled: false };
  }
}

// SEAL: Simplify imports and usage by exposing a clean single entry point.
import { processPayoutJob } from '../../integrations/payments/stripePayouts';

export const makePayoutResponse = async (ctx: HonoEnv, db: D1Database, payload: { invoiceId: string; timecardId?: string; deliverableId?: string }) => {
  if (!isStripePayoutProvider(ctx.ENV)) {
    return { handled: false };
  }

  try {
    const result = await processPayoutJob(ctx, db, payload);
    if (!result.success) {
      return { handled: false, stripeErrorMessage: result.stripeErrorMessage };
    }
    return { handled: true, stripeTransferId: result.stripeTransferId };
  } catch (e) {
    const err = e as Error;
    return { handled: false, stripeErrorMessage: err.message };
  }
};

export { makePayoutCallbacks as createPayoutIntegration } from './handlers';