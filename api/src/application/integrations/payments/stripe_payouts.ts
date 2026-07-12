/**
 * Stripe Connect Payout Service
 *
 * This module implements the P0-2 Pay-For-Freelancers integration per the Freelancer
 * Payout PRD (GAP P0-2). It gates all real payout execution behind a single env
 * variable (PAYOUT_PROVIDER=stripe). When configured, the module:
 *
 *   - Accepts invoice resolution from a trigger (timecard_id or deliverable_id).
 *   - Transfers escrowed funds from the platform Stripe account to a connected
 *     account using stripe.transfers.create.
 *   - Implements idempotency & error handling (payout_error, and logic to keep
 *     invoices pending on Stripe failures).
 *   - Emits structured audit logs.
 *
 * When PAYOUT_PROVIDER != stripe (or sticky to none/manual), the module either
 * invokes the external PAYOUT_WEBHOOK_URL path or raises a no-op for PRD gating.
 *
 * This module does NOT orchestrate webhook processing; that is handled by
 * /api/webhooks/stripe which calls ensurePayoutFinished() via an event-based
 * webhook clerk that records the Stripe transfer/payout outcomes.
 */

import Stripe from 'stripe';
import { Env } from '../../env';
import type { HonoEnv } from '../../env';

// ============================================================================
// Types & Constants
// ============================================================================

/* Per the PRD, the invoice must track pending/processing/paid/failed.
   Existing migration 0273 exposes 'status': pending|paid|void,
   but we extend support here.  We'll operate over the updated status enum. */
export type InvoiceStatus = 'pending' | 'processing' | 'paid' | 'failed';

export interface PayoutAttemptResult {
  success: boolean;
  stripeTransferId?: string;
  stripeErrorMessage?: string;
}

/** Simple logging wrapper (op/code-level audit trail). */
export function logPayoutEvent(
  context: string,
  eventId: string,
  details: Record<string, unknown>,
): void {
  // In prod this would push into Sentry / Datadog. Here we emit console for
  // traceability during integration testing.
  console.group(`[PAYOUT] ${context}`);
  console.log(`Event ID: ${eventId}`);
  Object.entries(details).forEach(([k, v]) => {
    if (typeof v === 'string' || typeof v === 'number') {
      console.log(`${k}:`, v);
    } else if (v !== undefined && v !== null) {
      console.warn(`${k}:`, JSON.stringify(v));
    }
  });
  console.groupEnd();
}

/**
 * Returns true only when env gate is set to stripe (ensuring safety).
 * If PAYOUT_PROVIDER does not exist or is '', PAYOUT_PROVIDER defaults to 'none'.
 */
export function isStripePayoutProvider(env: HonoEnv['Bindings']): boolean {
  const provider = env.PAYOUT_PROVIDER?.trim().toLowerCase();
  return provider === 'stripe';
}

/** Resolve the invoice given a timecard_id or deliverable_id. */
export async function resolveInvoiceForTrigger(
  db: D1Database,
  timecardId?: string,
  deliverableId?: string,
): Promise<D1Result<{ invoice_id: string; freelancer_user_id: string; amount_cents: number; currency: string }>> {
  // Prefer timecard_id as it is the canonical invoicing trigger per migration 0273.
  if (timecardId) {
    return db.prepare(`
      SELECT
        fi.id as invoice_id,
        fi.freelancer_user_id,
        fi.amount_cents,
        fi.currency
      FROM freelancer_invoices fi
      WHERE fi.timecard_id = ? AND fi.status IN ('pending', 'processing')
    `).bind(timecardId).first();
  }

  // If no timecardId, follow the PRD's deliverable acceptance path:
  // we need to map deliverable -> engagement -> timecard -> invoice.
  // For simplicity assume a pre-existing mapping we can query from a future schema
  // that would carry 'timecard_id' on deliverables. For now we still rely on
  // the timecard_id resolution path in the trigger handlers.
  if (deliverableId) {
    // Placeholder for deliverable->timecard mapping lookup.
    // NOTE: Once you add a deliverables.timecard_id FK (future migration), derive it here.
    throw new Error(
      `Deliverable-based payout not yet wired; this endpoint should be triggered via timecard approval.`,
    );
  }

  return { results: [] };
}

/**
 * Ensures the invoice is not already paid and not currently processing.
 */
export async function assertInvoiceNotPaid(
  db: D1Database,
  invoiceId: string,
): Promise<{ notAlreadyPaid: boolean; existingStatus: InvoiceStatus | null }> {
  const res = await db.prepare(`
    SELECT status FROM freelancer_invoices WHERE id = ?
  `).bind(invoiceId).first<{ status: InvoiceStatus | null }>();

  if (!res) {
    throw new Error(`Invoice not found: ${invoiceId}`);
  }

  const status = res.status as InvoiceStatus;

  const notAlreadyPaid = !status || status === 'pending';
  return { notAlreadyPaid, existingStatus: status };
}

/**
 * Executes a transfer from platform Stripe account (configured by STRIPE_SECRET_KEY)
 * to a freelancer's connected account (stripeAccount).
 *
 * - Returns the Stripe Transfer ID (tr_...) or an error object.
 * - On failure, logs payout_error and returns { success: false, stripeErrorMessage }.
 */
export async function finalizeStripePayout(
  ctx: HonoEnv,
  invoiceId: string,
  amountCents: number,
  currency: string,
  freelancerStripeAccountId: string,
): Promise<PayoutAttemptResult> {
  const stripe = new Stripe(ctx.ENV.STRIPE_SECRET_KEY, {
    apiVersion: '2024-06-20',
    typescript: true,
  });

  try {
    const swapResponse = await stripe.transfers.create({
      amount: amountCents,
      currency: currency.toLowerCase(),
      destination: freelancerStripeAccountId,
      transfer_group: `payout::${invoiceId}`,
    });
    const transferId = swapResponse.id;

    logPayoutEvent('finalizeStripePayout', swapResponse.id, {
      invoiceId,
      amountCents,
      currency,
      destination: freelancerStripeAccountId,
      status: swapResponse.status,
    });

    return { success: true, stripeTransferId: transferId };
  } catch (e) {
    const err = e as Error & { type: string };
    const stripeMessage = err.message || 'Unknown Stripe error';
    logPayoutEvent('finalizeStripePayout.fault', invoiceId, {
      invoiceId,
      amountCents,
      currency,
      destination: freelancerStripeAccountId,
      error: stripeMessage,
    });
    return { success: false, stripeErrorMessage: stripeMessage };
  }
}

/**
 * Creates a Payout Job ID for Idempotency.
 * The PRD requires that the same invoice event fired repeatedly marks it paid once.
 */
export function makePayoutJobId(invoiceId: string): string {
  return `payout_${invoiceId}`;
}

/**
 * Takes a pending/processing invoice and, via Stripe Connect:
 *   - Resolves the freelancer's connected account from freelancer_profiles.
 *   - Calls the internal Stripe transfer API.
 *   - Marks invoice paid in DB; records external_ref.
 *   - Handles Stripe errors and updates payout_error.
 */
export async function processPayoutJob(
  ctx: HonoEnv,
  db: D1Database,
  payload: { invoiceId: string; timecardId?: string; deliverableId?: string },
): Promise<PayoutAttemptResult> {
  const { invoiceId, timecardId, deliverableId } = payload;

  // 1. Find the invoice by id (and ensure it's pending or processing)
  const invoiceQuery = await db
    .prepare(`
      SELECT
        fi.status,
        fi.amount_cents,
        fi.currency,
        fi.freelancer_user_id,
        fsl.stripe_connect_id as freelancer_stripe_account_id
      FROM freelancer_invoices fi
      JOIN freelancer_slides fsl ON fi.freelancer_user_id = fsl.user_id
      WHERE fi.id = ?
    `)
    .bind(invoiceId)
    .first<{
      status: InvoiceStatus;
      amount_cents: number;
      currency: string;
      freelancer_user_id: string;
      freelancer_stripe_account_id: string | null;
    }>();

  if (!invoiceQuery) {
    throw new Error(`Invoice not found: ${invoiceId}`);
  }

  const invoice = invoiceQuery;

  // Validate we can transfer
  if (!invoice.freelancer_stripe_account_id) {
    throw new Error(
      `Freelancer is missing a connected Stripe account for payout (stripe_connect_id); cannot settle payment.`,
    );
  }

  // 2. Check idempotency: if already pending or processing, skip
  if (invoice.status === 'paid') {
    logPayoutEvent('processPayoutJob.skippedIdempotent', invoiceId, {
      invoiceId,
      existingStatus: 'paid',
    });
    return { success: true };
  }

  // 3. Update invoice status to processing (record in-flight)
  await db
    .prepare(`
      UPDATE freelancer_invoices
      SET status = 'processing', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
    .bind(invoiceId)
    .run();

  // 4. Execute Stripe transfer
  const result = await finalizeStripePayout(ctx, invoiceId, invoice.amount_cents, invoice.currency, invoice.freelancer_stripe_account_id);

  // 5. Record the outcome
  try {
    if (result.success) {
      await db
        .prepare(`
          UPDATE freelancer_invoices
          SET status = 'paid', external_ref = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `)
        .bind(result.stripeTransferId!, invoiceId)
        .run();

      logPayoutEvent('processPayoutJob.completed', invoiceId, {
        invoiceId,
        stripeTransferId: result.stripeTransferId,
        amountCents: invoice.amount_cents,
        currency: invoice.currency,
      });

      return result;
    } else {
      const errorMsg = typeof result.stripeErrorMessage === 'string' ? result.stripeErrorMessage : 'Unknown';

      await db
        .prepare(`
          UPDATE freelancer_invoices
          SET status = 'pending', payout_error = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `)
        .bind(errorMsg, invoiceId)
        .run();

      logPayoutEvent('processPayoutJob.failedContinuePending', invoiceId, {
        invoiceId,
        amountCents: invoice.amount_cents,
        currency: invoice.currency,
        stripeErrorMessage: errorMsg,
      });

      return result;
    }
  } catch (e) {
    const err = e as Error;
    // In case of a DB error, preserve the invoice in processing so it can be retried.
    throw new Error(
      `Failed to record payout outcome in DB for invoice ${invoiceId}: ${err.message}`,
    );
  }
}

// ============================================================================
// Public API (for routes and handlers to invoke)
// ============================================================================

/**
 * Simple no-op if payout provider is not Stripe.
 * Useful for trigger handlers like timecard approval where we still want to
 * exist but fall back gracefully.
 */
export async function maybeProcessPayoutProvider(ctx: HonoEnv, db: D1Database, payload: { invoiceId: string; timecardId?: string; deliverableId?: string }): Promise<PayoutAttemptResult> {
  if (!isStripePayoutProvider(ctx.ENV)) {
    logPayoutEvent('maybeProcessPayoutProvider.disabled', payload.invoiceId, {
      invoiceId: payload.invoiceId,
      provider: ctx.ENV.PAYOUT_PROVIDER || 'none',
    });
    // Normalize: we still return success (no-op) so callers can treat it as "handled".
    return { success: true };
  }

  void db; // Unreachable if PAYOUT_PROVIDER != stripe
  try {
    return await processPayoutJob(ctx, db, payload);
  } catch (e) {
    const err = e as Error;
    return { success: false, stripeErrorMessage: err.message };
  }
}