/**
 * Tracking webhooks — open, click, unsubscribe, and the SMS delivery-status
 * callback (with its signature check). Split out of `../campaignEngine.ts`, which
 * re-exports it.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { Env } from '../../../env';
import type { Db } from '../../../infrastructure/database/connection';
import {
  marketingAudienceMembers,
  marketingCampaignSends,
  marketingCampaigns,
} from '../../../infrastructure/database/schema';
import { isOptOutFailure } from '../campaignTransports';
import { fireEventTriggers } from '../../workflow/eventTriggers';
import { suppressEmails } from './audiences';

// ---------------------------------------------------------------------------
// Tracking — open / click / unsubscribe
// ---------------------------------------------------------------------------

/** 1×1 transparent GIF, the open pixel. */
export const TRACKING_PIXEL = Uint8Array.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00,
  0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02,
  0x44, 0x01, 0x00, 0x3b,
]);

/**
 * Record an open. First open only — `opened_at IS NULL` in the WHERE means the
 * campaign counter tracks unique opens rather than however many times a client
 * re-fetched the image.
 */
export async function recordOpen(db: Db, trackToken: string, env?: Env): Promise<void> {
  const updated = await db
    .update(marketingCampaignSends)
    .set({ openedAt: sql`NOW()` })
    .where(and(
      eq(marketingCampaignSends.trackToken, trackToken),
      sql`${marketingCampaignSends.openedAt} IS NULL`,
    ))
    .returning({ campaignId: marketingCampaignSends.campaignId, tenantId: marketingCampaignSends.tenantId, email: marketingCampaignSends.email });
  const hit = updated[0];
  if (!hit) return;
  await db
    .update(marketingCampaigns)
    .set({ opened: sql`${marketingCampaigns.opened} + 1`, updatedAt: sql`NOW()` })
    .where(and(eq(marketingCampaigns.id, hit.campaignId), eq(marketingCampaigns.tenantId, hit.tenantId)));
  // FIRST open only — the guard above already made this branch unique per send, so
  // an `email-open` workflow fires once per recipient rather than once per image
  // re-fetch by their mail client.
  await fireEventTriggers(db, {
    tenantId: hit.tenantId, env,
    eventType: 'email-open',
    payload: { campaignId: hit.campaignId, email: hit.email },
    match: { campaign: String(hit.campaignId) },
  }).catch(() => undefined);
}

/** Record a click and return the destination to redirect to (validated). */
export async function recordClick(db: Db, trackToken: string, rawUrl: string, env?: Env): Promise<string | null> {
  // Only ever redirect to an absolute http(s) URL — an open redirect to
  // `javascript:` or a protocol-relative URL would be a real vulnerability.
  let destination: URL;
  try {
    destination = new URL(rawUrl);
  } catch {
    return null;
  }
  if (destination.protocol !== 'http:' && destination.protocol !== 'https:') return null;

  const updated = await db
    .update(marketingCampaignSends)
    .set({ clickedAt: sql`NOW()` })
    .where(and(
      eq(marketingCampaignSends.trackToken, trackToken),
      sql`${marketingCampaignSends.clickedAt} IS NULL`,
    ))
    .returning({ campaignId: marketingCampaignSends.campaignId, tenantId: marketingCampaignSends.tenantId, email: marketingCampaignSends.email });
  const hit = updated[0];
  if (hit) {
    await db
      .update(marketingCampaigns)
      .set({ clicked: sql`${marketingCampaigns.clicked} + 1`, updatedAt: sql`NOW()` })
      .where(and(eq(marketingCampaigns.id, hit.campaignId), eq(marketingCampaigns.tenantId, hit.tenantId)));
    // First click only, same reasoning as recordOpen. The redirect below happens
    // regardless — a workflow must never be able to break the link the reader clicked.
    await fireEventTriggers(db, {
      tenantId: hit.tenantId, env,
      eventType: 'email-click',
      payload: { campaignId: hit.campaignId, email: hit.email, destination: destination.toString() },
      match: { campaign: String(hit.campaignId) },
    }).catch(() => undefined);
  }
  return destination.toString();
}

/**
 * Honour an unsubscribe. Writes the tenant-wide suppression AND flips audience
 * membership, so the person is gone from every future campaign, not just this
 * one. Returns the address so the confirmation page can name it.
 */
export async function recordUnsubscribe(db: Db, trackToken: string): Promise<string | null> {
  const [send] = await db
    .select({ email: marketingCampaignSends.email, tenantId: marketingCampaignSends.tenantId })
    .from(marketingCampaignSends)
    .where(eq(marketingCampaignSends.trackToken, trackToken))
    .limit(1);
  if (!send) return null;

  await suppressEmails(db, send.tenantId, [send.email], 'unsubscribed');
  await db
    .update(marketingAudienceMembers)
    .set({ status: 'unsubscribed', updatedAt: sql`NOW()` })
    .where(and(
      eq(marketingAudienceMembers.tenantId, send.tenantId),
      eq(marketingAudienceMembers.email, send.email),
    ));
  return send.email;
}

// ---------------------------------------------------------------------------
// SMS delivery status — the other half of "did it arrive"
// ---------------------------------------------------------------------------

/** Twilio's message lifecycle, as it reports it. `delivered` and the two failure
 *  states are TERMINAL; the rest are progress. */
export const SMS_TERMINAL_FAILURES: readonly string[] = ['undelivered', 'failed'];

/**
 * Record what the carrier says happened to one message.
 *
 * The counters are CORRECTED here, not merely annotated. `runCampaignBatch`
 * increments `sent` when the message is handed over, which is the only thing it
 * can know at the time; when the carrier later says it never arrived, a campaign
 * report that still claims it was sent is simply wrong. Moving the send to
 * `failed` and swapping one counter for the other keeps a single set of numbers
 * that mean "reached a person" — rather than a second, quieter set that only a
 * reader who knew to look would find.
 *
 * Idempotent by construction: the correction is guarded on the row still being
 * `sent`, so Twilio's habit of retrying a callback cannot double-count. Progress
 * states (`queued`, `sending`, `sent`) only stamp `delivery_status`.
 */
export async function recordSmsDeliveryStatus(
  db: Db,
  trackToken: string,
  status: string,
  detail: { messageSid?: string | null; errorCode?: string | null } = {},
): Promise<boolean> {
  const normalized = status.trim().toLowerCase().slice(0, 24);
  if (!normalized) return false;
  const delivered = normalized === 'delivered';

  const [send] = await db
    .update(marketingCampaignSends)
    .set({
      deliveryStatus: normalized,
      ...(delivered ? { deliveredAt: sql`NOW()` } : {}),
      ...(detail.messageSid ? { externalMessageId: detail.messageSid.slice(0, 64) } : {}),
    })
    .where(eq(marketingCampaignSends.trackToken, trackToken))
    .returning({
      id: marketingCampaignSends.id,
      campaignId: marketingCampaignSends.campaignId,
      tenantId: marketingCampaignSends.tenantId,
      email: marketingCampaignSends.email,
      status: marketingCampaignSends.status,
    });
  if (!send) return false;

  if (!SMS_TERMINAL_FAILURES.includes(normalized)) return true;

  const reason = detail.errorCode ? `Twilio ${normalized} (${detail.errorCode})` : `Twilio ${normalized}`;
  const corrected = await db
    .update(marketingCampaignSends)
    .set({ status: 'failed', error: reason.slice(0, 1_000) })
    .where(and(
      eq(marketingCampaignSends.id, send.id),
      eq(marketingCampaignSends.tenantId, send.tenantId),
      // Only a send WE counted as sent needs correcting, and only once.
      eq(marketingCampaignSends.status, 'sent'),
    ))
    .returning({ id: marketingCampaignSends.id });
  if (corrected.length > 0) {
    await db
      .update(marketingCampaigns)
      .set({
        sent: sql`GREATEST(${marketingCampaigns.sent} - 1, 0)`,
        failed: sql`${marketingCampaigns.failed} + 1`,
        updatedAt: sql`NOW()`,
      })
      .where(and(eq(marketingCampaigns.id, send.campaignId), eq(marketingCampaigns.tenantId, send.tenantId)));
  }

  // A carrier STOP arrives here as well as on the send call, because a message
  // accepted at hand-over can still be rejected downstream.
  if (detail.errorCode && isOptOutFailure(detail.errorCode)) {
    await db
      .update(marketingAudienceMembers)
      .set({ phoneStatus: 'unsubscribed', updatedAt: sql`NOW()` })
      .where(and(
        eq(marketingAudienceMembers.tenantId, send.tenantId),
        eq(marketingAudienceMembers.email, send.email),
      ));
  }
  return true;
}

export type SmsCallbackVerification = { ok: true } | { ok: false; reason: string };

/**
 * Decide whether a Twilio status callback is genuinely from Twilio.
 *
 * The auth token a callback is signed with belongs to the TENANT's own Twilio
 * connection, so verification starts from the token in the URL: send → campaign
 * → connection → credentials. There is no platform-wide secret to check against
 * and there should not be one, because the callback is generated by the tenant's
 * account, not ours.
 *
 * Two cases resolve to "accept without checking a signature", and both are
 * deliberate:
 *
 *   • an UNKNOWN token — there is no send to record against, so the recorder
 *     no-ops and the route answers 204. Refusing would turn a deleted campaign
 *     into a permanent Twilio retry loop.
 *   • a connection authenticated with an API KEY (`SK…`) rather than the Account
 *     SID — Twilio signs with the Auth Token and nothing else, so the signature
 *     is genuinely uncheckable. The unguessable per-send token remains the
 *     access model, exactly as it is for the open pixel and the unsubscribe
 *     link, and the worst a forgery achieves is one wrong delivery state.
 */
export async function verifyCampaignSmsCallback(
  db: Db,
  env: Env,
  args: {
    trackToken: string;
    url: string;
    signature: string | null;
    formParams: Array<[string, string]>;
  },
): Promise<SmsCallbackVerification> {
  const [send] = await db
    .select({ campaignId: marketingCampaignSends.campaignId, tenantId: marketingCampaignSends.tenantId })
    .from(marketingCampaignSends)
    .where(eq(marketingCampaignSends.trackToken, args.trackToken))
    .limit(1);
  if (!send) return { ok: true };

  const [campaign] = await db
    .select({
      channel: marketingCampaigns.channel,
      connectorConnectionId: marketingCampaigns.connectorConnectionId,
    })
    .from(marketingCampaigns)
    .where(and(
      eq(marketingCampaigns.id, send.campaignId),
      eq(marketingCampaigns.tenantId, send.tenantId),
    ))
    .limit(1);
  if (!campaign) return { ok: true };
  if (campaign.channel !== 'sms') return { ok: false, reason: 'that campaign is not an SMS campaign' };
  if (!campaign.connectorConnectionId) return { ok: false, reason: 'that campaign has no Twilio connection' };

  const { loadConnection } = await import('../../connectors/connectorRuntime');
  const connection = await loadConnection(db, env, send.tenantId, campaign.connectorConnectionId);
  const username = connection.auth.username ?? '';
  const authToken = connection.auth.password ?? '';
  // Only an Account SID pairs with the Auth Token; an `SK…` API key pairs with a
  // secret Twilio never signs with. See the header.
  if (!username.startsWith('AC') || !authToken) return { ok: true };

  const { verifyTwilioSignature } = await import('../../backend/webhookVerification');
  const result = await verifyTwilioSignature({
    url: args.url,
    signature: args.signature,
    authToken,
    formParams: args.formParams,
    rawBody: '',
    isForm: true,
  });
  return result.ok ? { ok: true } : { ok: false, reason: result.reason };
}
