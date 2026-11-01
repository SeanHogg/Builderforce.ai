/**
 * Sending — one bounded, resumable batch of a started campaign. Split out of
 * `../campaignEngine.ts`, which re-exports it (the two policy constants included).
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Env } from '../../../env';
import type { Db } from '../../../infrastructure/database/connection';
import {
  marketingAudienceMembers,
  marketingCampaignSends,
  marketingCampaigns,
} from '../../../infrastructure/database/schema';
import { reportCaughtError } from '../../observability/caughtErrorReporter';
import { isOptOutFailure, resolveCampaignSender, TransportError } from '../campaignTransports';
import { defaultLogoUrl, resolveAssetOrigin } from '../templateLibrary';
import {
  renderCampaignEmail,
  renderCampaignSms,
  smsStatusUrl,
  trackingUrls,
  type RenderContext,
} from './render';
import { loadTransportBinding } from './start';
import { CAMPAIGN_DELIVERY_MAX_ATTEMPTS, failedDeliveryStatus } from '../../shared/campaignDelivery';
import { isInFlight } from '../../shared/campaignLifecycle';
import { signalPendingWork } from '../../runtime/cronWorkSignal';

/** How many recipients one batch attempts. Bounded by the Worker's subrequest
 *  budget, not by taste — each send is one outbound HTTP call. */
export const SEND_BATCH_SIZE = 25;

/**
 * How many times one recipient may be attempted before it is written off — the
 * ceiling every campaign channel shares (`shared/campaignDelivery.ts`). Re-exported
 * under its historical name for the engine's public surface.
 */
export const CAMPAIGN_SEND_MAX_ATTEMPTS = CAMPAIGN_DELIVERY_MAX_ATTEMPTS;

/**
 * How long a recipient may sit in `sending` before the sweep writes it off as `failed`.
 *
 * A row is `sending` only between its claim and the write-back that follows the transport
 * call, so it should leave that state within one batch: at most `SEND_BATCH_SIZE` (25)
 * sequential sends, each bounded by a transport's own HTTP timeout of well under a minute —
 * a few minutes in the worst case, and a Worker invocation is cut off long before an hour.
 * One hour is far above that, so a live runner's claim is not reaped in practice, and still
 * short enough that a campaign whose runner was evicted finishes the same day. Not a
 * guarantee: a row with no `claimed_at` (claimed before 1291 added the column, e.g. by a runner
 * still on the old code during the deploy window) is reaped at once. That is why the write-backs
 * below are conditional on the row still being `sending` — a reaped row is never overwritten.
 */
export const STALE_CLAIM_AFTER_MS = 60 * 60 * 1000;

/** What a reaped row says. `failed`, not `queued`: the transport call may have succeeded
 *  before the runner died, and sending again could deliver the same message twice. */
export const STALE_CLAIM_ERROR =
  'Delivery state unknown: the sender stopped after claiming this message and before recording the outcome, '
  + 'so it may or may not have been delivered. It was not retried, to avoid sending it twice.';

export interface BatchResult {
  sent: number;
  failed: number;
  remaining: number;
  status: string;
}

/**
 * Fail a campaign whose SENDER is dead, and settle every row it still owns.
 *
 * Order matters. Rows are settled BEFORE the campaign is flipped, so a crash between the two
 * leaves a campaign that is still in flight (the next tick repeats this) rather than a
 * `failed` one with rows nobody will touch. `queued` goes first: once no row is `queued`
 * nothing can be newly claimed, so the `sending` settle that follows cannot miss a row. That
 * settle has to run at all, because a failed campaign has left the in-flight set and the
 * stale-claim sweep (`reapStaleClaims`) never visits it again. Those `sending` rows get the
 * same "delivery state unknown" verdict the sweep would have given them, not the sender's
 * error: another runner may have delivered them.
 *
 * `delta` is what the calling batch already did, so its counters land in the same write.
 */
async function failCampaign(
  db: Db,
  tenantId: number,
  campaignId: number,
  reason: string,
  delta: { sent: number; failed: number },
): Promise<void> {
  await db
    .update(marketingCampaignSends)
    .set({ status: 'failed', error: reason.slice(0, 1_000) })
    .where(and(
      eq(marketingCampaignSends.campaignId, campaignId),
      eq(marketingCampaignSends.tenantId, tenantId),
      eq(marketingCampaignSends.status, 'queued'),
    ));
  const abandoned = await db
    .update(marketingCampaignSends)
    .set({ status: 'failed', error: STALE_CLAIM_ERROR })
    .where(and(
      eq(marketingCampaignSends.campaignId, campaignId),
      eq(marketingCampaignSends.tenantId, tenantId),
      eq(marketingCampaignSends.status, 'sending'),
    ))
    .returning({ id: marketingCampaignSends.id });
  await db
    .update(marketingCampaigns)
    .set({
      status: 'failed',
      sent: sql`${marketingCampaigns.sent} + ${delta.sent}`,
      failed: sql`${marketingCampaigns.failed} + ${delta.failed + abandoned.length}`,
      completedAt: sql`NOW()`,
      updatedAt: sql`NOW()`,
    })
    .where(and(eq(marketingCampaigns.id, campaignId), eq(marketingCampaigns.tenantId, tenantId)));
}

/**
 * Send the next batch of queued messages.
 *
 * Each recipient is claimed with a conditional UPDATE before its email goes out,
 * so two concurrent runners (a manual "send now" racing the cron) cannot both
 * send the same message — the loser's UPDATE matches zero rows and it skips.
 *
 * The transport is resolved ONCE per batch, not per recipient: resolving it
 * refreshes an OAuth token and reads a connector connection, and doing that 25
 * times for one batch would triple the batch's wall clock for no benefit.
 */
export async function runCampaignBatch(
  env: Env,
  db: Db,
  tenantId: number,
  campaignId: number,
  opts: { batchSize?: number; trackingOrigin: string } = { trackingOrigin: '' },
): Promise<BatchResult> {
  const batchSize = Math.min(Math.max(1, opts.batchSize ?? SEND_BATCH_SIZE), 100);

  const campaign = await loadTransportBinding(db, tenantId, campaignId);
  if (!campaign || !isInFlight('email', campaign.status)) {
    return { sent: 0, failed: 0, remaining: 0, status: campaign?.status ?? 'missing' };
  }

  const resolved = await resolveCampaignSender(db, env, tenantId, campaign.binding);
  if (!resolved.ok) {
    // The transport that passed pre-flight has since broken (mailbox revoked,
    // sender un-verified, connection deleted). Every remaining recipient would
    // fail identically, so the campaign fails as a whole and says why — rather
    // than grinding through the audience writing the same error N times.
    await failCampaign(db, tenantId, campaignId, resolved.error, { sent: 0, failed: 0 });
    return { sent: 0, failed: 0, remaining: 0, status: 'failed' };
  }
  const sender = resolved.sender;

  // Resolved once per batch for the same reason as the transport — `{{logo}}` is
  // a tenant-level fact, not a per-recipient one.
  const logoUrl = await defaultLogoUrl(db, tenantId, resolveAssetOrigin(env));

  const queued = await db
    .select({
      id: marketingCampaignSends.id,
      email: marketingCampaignSends.email,
      phone: marketingCampaignSends.phone,
      trackToken: marketingCampaignSends.trackToken,
      attempts: marketingCampaignSends.attempts,
      // Joined so merge fields resolve without a query per recipient — the N+1
      // this replaces would be one round-trip per person in the audience.
      name: marketingAudienceMembers.name,
      attributes: marketingAudienceMembers.attributes,
    })
    .from(marketingCampaignSends)
    .leftJoin(marketingAudienceMembers, and(
      eq(marketingAudienceMembers.audienceId, campaign.audienceId),
      eq(marketingAudienceMembers.email, marketingCampaignSends.email),
      eq(marketingAudienceMembers.tenantId, tenantId),
    ))
    .where(and(
      eq(marketingCampaignSends.campaignId, campaignId),
      eq(marketingCampaignSends.tenantId, tenantId),
      eq(marketingCampaignSends.status, 'queued'),
    ))
    .orderBy(asc(marketingCampaignSends.id))
    .limit(batchSize);

  let sent = 0;
  let failed = 0;
  // Set when a terminal SENDER failure (a revoked grant, a wrong key) ends the batch.
  let senderFailure: string | null = null;

  for (const row of queued) {
    // Claim: only the runner whose UPDATE matches gets to send this one. The
    // attempt is counted AT CLAIM TIME, not on failure — a runner that dies
    // mid-send (a Worker eviction) would otherwise leave the row claimable
    // forever with its counter untouched.
    const claimed = await db
      .update(marketingCampaignSends)
      .set({ status: 'sending', attempts: sql`${marketingCampaignSends.attempts} + 1`, claimedAt: sql`NOW()` })
      .where(and(
        eq(marketingCampaignSends.id, row.id),
        eq(marketingCampaignSends.tenantId, tenantId),
        eq(marketingCampaignSends.status, 'queued'),
      ))
      .returning({ id: marketingCampaignSends.id });
    if (claimed.length === 0) continue;

    const ctx: RenderContext = {
      trackingOrigin: opts.trackingOrigin,
      trackToken: row.trackToken,
      logoUrl,
    };
    const recipient = {
      email: row.email,
      name: row.name ?? undefined,
      attributes: (row.attributes as Record<string, unknown> | null) ?? undefined,
    };
    // The CHANNEL picks the address and the body; everything around it — the
    // claim, the attempt ceiling, the requeue rule — is identical either way.
    const isSms = sender.channel === 'sms';
    const html = isSms ? '' : renderCampaignEmail(campaign.bodyHtml, ctx, recipient);
    const text = isSms ? renderCampaignSms(campaign.bodyText, recipient) : undefined;
    const to = isSms ? (row.phone ?? '') : row.email;
    try {
      // Materialisation only queues members with a usable number, so an empty
      // one here means the row was written before this campaign became an SMS.
      // Terminal by construction: no retry can invent a phone number.
      if (!to) throw new TransportError('No mobile number for this recipient.', false, 'recipient');
      const receipt = await sender.send({
        to,
        subject: campaign.subject,
        html,
        ...(text !== undefined ? { text } : {}),
        unsubscribeUrl: trackingUrls(ctx).unsubscribe,
        // Twilio only reports delivery to a URL supplied at send time, and the
        // send's own track token is already unguessable and resolves to exactly
        // one row — so no second identifier has to be minted for the callback.
        ...(isSms ? { statusCallbackUrl: smsStatusUrl(ctx) } : {}),
      });
      // Conditional on the row still being `sending`: if the sweep reaped it while this runner
      // was in the transport call, the reaper has already counted it failed, and overwriting it
      // here would count it twice. A message that did go out for a reaped row is the "delivery
      // state unknown" the reaper's verdict already says.
      const settled = await db
        .update(marketingCampaignSends)
        .set({
          status: 'sent',
          sentAt: sql`NOW()`,
          error: null,
          ...(receipt.externalId ? { externalMessageId: receipt.externalId } : {}),
        })
        .where(and(
          eq(marketingCampaignSends.id, row.id),
          eq(marketingCampaignSends.tenantId, tenantId),
          eq(marketingCampaignSends.status, 'sending'),
        ))
        .returning({ id: marketingCampaignSends.id });
      if (settled.length > 0) sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'send failed';
      // A carrier STOP is a CONSENT withdrawal, not a delivery failure: without
      // this the same person is texted again by the next campaign, and the one
      // after that, because nothing recorded that they asked us not to.
      if (isSms && isOptOutFailure(message)) {
        await db
          .update(marketingAudienceMembers)
          .set({ phoneStatus: 'unsubscribed', updatedAt: sql`NOW()` })
          .where(and(
            eq(marketingAudienceMembers.tenantId, tenantId),
            eq(marketingAudienceMembers.audienceId, campaign.audienceId),
            eq(marketingAudienceMembers.email, row.email),
          ));
      }
      // A retryable failure goes BACK to `queued` so the next sweep picks it up;
      // only a terminal one becomes a `failed` row. Burning a recipient on a
      // transient 429 is how a campaign silently under-delivers — and the
      // attempt ceiling is what stops the opposite failure, an unsendable
      // recipient requeued forever so the campaign never completes.
      const requeue = failedDeliveryStatus(row.attempts + 1, error instanceof TransportError && error.retryable) === 'queued';
      const settled = await db
        .update(marketingCampaignSends)
        .set({ status: requeue ? 'queued' : 'failed', error: message.slice(0, 1_000) })
        .where(and(
          eq(marketingCampaignSends.id, row.id),
          eq(marketingCampaignSends.tenantId, tenantId),
          eq(marketingCampaignSends.status, 'sending'),
        ))
        .returning({ id: marketingCampaignSends.id });
      if (!requeue && settled.length > 0) failed += 1;
      reportCaughtError(error, { source: 'application/marketing/campaign/send.ts', operation: 'runCampaignBatch' });
      // WHOSE failure decides what happens next. A terminal failure of the SENDER (a revoked
      // grant, a wrong API key) fails every remaining recipient the same way: stop, and fail the
      // campaign instead of retrying a dead pipe. A terminal failure of the RECIPIENT (a number
      // the carrier refuses, a STOP) says nothing about the next one: that row is already
      // `failed`, so the batch carries on.
      if (error instanceof TransportError && !error.retryable && error.scope === 'sender') {
        senderFailure = message;
        break;
      }
    }
  }

  if (senderFailure !== null) {
    await failCampaign(db, tenantId, campaignId, senderFailure, { sent, failed });
    return { sent, failed, remaining: 0, status: 'failed' };
  }

  // `remaining` counts everything not yet settled (a `sending` row included) and is what decides
  // whether the campaign is done. `queuedLeft` counts only what a later batch can still CLAIM:
  // a `sending` row is another runner's, or a dead one's, and no batch advances it.
  const [{ remaining, queuedLeft } = { remaining: 0, queuedLeft: 0 }] = await db
    .select({
      remaining: sql<number>`count(*)::int`,
      queuedLeft: sql<number>`(count(*) FILTER (WHERE ${marketingCampaignSends.status} = 'queued'))::int`,
    })
    .from(marketingCampaignSends)
    .where(and(
      eq(marketingCampaignSends.campaignId, campaignId),
      eq(marketingCampaignSends.tenantId, tenantId),
      inArray(marketingCampaignSends.status, ['queued', 'sending']),
    ));

  const done = Number(remaining) === 0;
  await db
    .update(marketingCampaigns)
    .set({
      sent: sql`${marketingCampaigns.sent} + ${sent}`,
      failed: sql`${marketingCampaigns.failed} + ${failed}`,
      ...(done ? { status: 'sent' as const, completedAt: sql`NOW()` } : {}),
      updatedAt: sql`NOW()`,
    })
    .where(and(eq(marketingCampaigns.id, campaignId), eq(marketingCampaigns.tenantId, tenantId)));

  // Only the first batch runs inline; the rest is finished by the gated cron sweep. The
  // frequent tick skips Postgres entirely unless work was signalled, so without this a
  // send larger than one batch would advance one batch per FLOOR tick.
  //
  // Signalled only when this batch SETTLED something (sent, or failed for good) AND a later
  // one has something to claim. Both halves keep the gate from pinning open: a `sending` row
  // nobody will advance (an evicted Worker) must not re-signal every tick forever, and a batch
  // that only requeued (a provider answering 429 or 5xx to everything) has no reason to expect
  // the next batch to do better, so it falls back to the floor cadence and lets Neon suspend.
  // A recipient-level failure DOES count as progress: that row is done and the next one may be
  // fine, which is what keeps a bad number in the first row from stalling the campaign.
  //
  // Bounded: every signalling batch settles at least one row for good (`sent` and `failed` never
  // go back to `queued`), so the signals one campaign raises cannot exceed its audience, and a
  // requeue is capped by the attempt ceiling (`CAMPAIGN_SEND_MAX_ATTEMPTS`, counted at claim).
  if (!done && sent + failed > 0 && Number(queuedLeft ?? 0) > 0) await signalPendingWork(env);

  return { sent, failed, remaining: Number(remaining), status: done ? 'sent' : 'sending' };
}
