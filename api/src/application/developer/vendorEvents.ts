/**
 * TELLING THE VENDOR — the notification half of PRD 24 §5.4 step 3.
 *
 * A tenant installs a paid extension and never creates an account with the
 * vendor. That is the whole Vercel move (§2.4), and it leaves the vendor with a
 * problem: their integration server has to provision something for a customer it
 * has never met. This is how it finds out.
 *
 * ── THE THREE THINGS THIS MODULE IS CAREFUL ABOUT ───────────────────────────
 *
 * 1. **It is not a second emitter.** Delivery, signing, replay protection, the
 *    backoff curve and the delivery log are `seams/webhookService.ts` — the same
 *    machine the canvas API and the channel-3 seams use. What is new here is a
 *    payload and a choice of audience, which is a caller, not a subsystem.
 *
 * 2. **The audience is the PUBLISHER's workspace, not the installing one.** Every
 *    other emit on this platform notifies the tenant the thing happened IN; this
 *    one notifies the tenant that SOLD it. Passing the wrong tenant here would
 *    deliver a vendor's install feed to their customer, so the tenant is named
 *    `publisherTenantId` at every level rather than being called `tenantId` and
 *    hoped about.
 *
 * 3. **The install id is the only identity that crosses.** A vendor learns that
 *    an install happened, on what plan, at what version — not who the customer is.
 *    The customer's workspace id, name and members are deliberately absent: the
 *    install id is opaque, stable, and the handle the vendor uses to talk back to
 *    us (`extensionInstallTokens.ts`), so it is sufficient without being
 *    identifying. A vendor who needs to know the customer asks the customer.
 *
 * ── WHY EMITTING NEVER THROWS ───────────────────────────────────────────────
 * Every caller is a mutation that has already committed. An install that
 * succeeded, took money and then 500ed because the vendor's endpoint was down
 * would be the platform reporting its own success as a failure — and the retry
 * sweep is already the answer to a vendor being unreachable.
 */

import type { Db } from '../../infrastructure/database/connection';
import { emitWebhookEvent, type WebhookEvent } from '../seams/webhookService';
import { reportCaughtError } from '../observability/caughtErrorReporter';

/** What every install event carries. Additive only — a vendor parses by key. */
export interface InstallEventPayload {
  /** The opaque handle the vendor uses to talk back to us. The ONLY identity. */
  installId: string;
  packageId: string;
  packageSlug: string;
  versionId: string;
  semver: string;
  /** Scopes the customer's admin actually approved — not what the version asked. */
  grantedScopes: string[];
  /** NULL for a free install. */
  planCode: string | null;
  subscriptionState: string;
  [key: string]: unknown;
}

/**
 * Deliver one install event to the publisher's subscriptions.
 *
 * `occurrence` is the second half of the replay key (`uq_webhook_delivery_event`
 * is on subscription + event type + event id), and it is a REQUIRED parameter
 * rather than a defaulted one for a reason the emitter's own doc comment spells
 * out: an event id that is not unique per occurrence silently swallows a
 * legitimate second event as a duplicate. An install's id alone is stable across
 * every event about it, so it is composed with what actually changed — the
 * version and the plan — which makes a retried request collide and two real
 * changes never collide.
 */
export async function emitInstallEvent(
  db: Db,
  input: {
    publisherTenantId: number;
    event: Extract<WebhookEvent, `extension.${string}`>;
    payload: InstallEventPayload;
  },
): Promise<void> {
  const { payload } = input;
  const occurrence = `${payload.installId}.${payload.versionId}.${payload.planCode ?? 'free'}.${payload.subscriptionState}`;
  try {
    await emitWebhookEvent(db, {
      // The PUBLISHER's workspace — see point 2 in the header.
      tenantId: input.publisherTenantId,
      eventType: input.event,
      eventId: occurrence,
      data: payload,
    });
  } catch (error) {
    // The emitter is already best-effort per endpoint; this catches the case where
    // reading the subscription list itself fails, which must not turn a completed
    // install into a 500.
    reportCaughtError(error, {
      source: 'application/developer/vendorEvents.ts',
      operation: `emitInstallEvent:${input.event}`,
    });
  }
}
