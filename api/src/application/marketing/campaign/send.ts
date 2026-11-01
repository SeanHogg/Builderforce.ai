/**
 * Sending — one bounded, resumable batch of a started campaign. Split out of
 * `../campaignEngine.ts`, which re-exports it (the two policy constants included).
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Env } from '../../../env';
import { inTransaction, type Db } from '../../../infrastructure/database/connection';
import {
  marketingAudienceMembers,
  marketingCampaignSends,
  marketingCampaigns,
} from '../../../infrastructure/database/schema';
import { reportCaughtError } from '../../observability/caughtErrorReporter';
import { isPerRecipientCarrierFailure, isOptOutFailure, resolveCampaignSender, TransportError } from '../campaignTransports';
import { defaultLogoUrl, resolveAssetOrigin } from '../templateLibrary';
import {
  renderCampaignEmail,
  renderCampaignSms,
  smsStatusUrl,
  trackingUrls,
  type RenderContext,
} from './render';
import { campaignMemberKeys, isMemberBlocked, suppressedEmails } from '../suppression';
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

/** What a row says when the per-batch do-not-contact re-check settles it: the person was added to a
 *  register after the campaign started, so the message was never sent. */
export const DO_NOT_CONTACT_SEND_ERROR =
  'Not sent: this contact was added to a do-not-contact list after the campaign started.';

/**
 * How many recipient-terminal failures in a row, with the SAME normalised message and NOTHING
 * DELIVERED BY THE CAMPAIGN AT ALL, mean the SENDER is unusable rather than the recipients.
 *
 * A provider that answers 400 for every message because the From (a Twilio number, a SendGrid
 * sender) is bad looks, row by row, exactly like a list of bad numbers. Fifteen identical failures
 * in a row with no send is not a coincidence a real list produces often (bad numbers fail with
 * differing messages once their digits are stripped, are interleaved with deliveries, and a
 * carrier STOP or any other known per-recipient Twilio code, such as a landline, is excluded
 * outright: those repeat identically by nature), and it costs a dead sender only fifteen attempts
 * before the campaign stops. Small enough that a dead sender is caught inside one batch (25),
 * large enough that a run of identical bad numbers at the head of a list does not fail the campaign.
 *
 * "Nothing delivered" is measured over the CAMPAIGN (`campaign.sent` plus this batch), not this
 * batch alone: a campaign that has already delivered to people has a working sender by proof, so a
 * later run of ten or fifteen identical failures (a block of one region's numbers, say) is a bad
 * stretch of the list, and failing the whole campaign permanently over it would strand everyone
 * still queued. Only a campaign that has never delivered anything can be diagnosed as a dead pipe.
 */
export const SENDER_FAILURE_STREAK = 15;

/**
 * A failure message with the per-recipient parts removed, so the same failure compares equal
 * across recipients. Email addresses and phone-number-like digit runs (7 or more digits, with
 * an optional `+` and separators) become placeholders, so a message that quotes the recipient
 * ("The 'To' number +14155550100 is not a valid phone number") still matches the next one.
 * Short numbers (an HTTP status, a Twilio error code such as 21211) are kept: they are the
 * discriminating part. Lower-cased and whitespace-collapsed.
 */
export function normalizeFailureMessage(message: string): string {
  return message
    .toLowerCase()
    .replace(/[^\s<>"'(),;:]+@[^\s<>"'(),;:]+/g, '<email>')
    .replace(/\+?\d[\d\s().-]{5,}\d/g, '<number>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

export interface BatchResult {
  sent: number;
  failed: number;
  remaining: number;
  status: string;
  /** Set when the batch ended before its claimed set was exhausted: the provider is not serving us
   *  (no answer, a 429 or a 5xx). The rows it had not claimed stay `queued` with no attempt spent. */
  stopped?: 'provider_unavailable';
}

/**
 * Fail a campaign whose SENDER is dead, and settle every row it still owns. Returns how many
 * rows it failed itself (the `queued` and `sending` rows it settled), so the caller can report
 * a `failed` that agrees with the ledger.
 *
 * ONE transaction, so a crash leaves either the whole settle or none of it. Inside it the order
 * still matters for a concurrent runner: `queued` goes first, so once it commits nothing can be
 * newly claimed and the `sending` settle that follows cannot miss a row. That settle has to run
 * at all, because a failed campaign has left the in-flight set and the stale-claim sweep
 * (`reapStaleClaims`) never visits it again. Those `sending` rows get the same "delivery state
 * unknown" verdict the sweep would have given them, not the sender's error: another runner may
 * have delivered them. Both settles are counted from `RETURNING`, and added to the campaign's
 * `failed` along with `delta` (what the calling batch already did, so its counters land in the
 * same write).
 */
async function failCampaign(
  db: Db,
  tenantId: number,
  campaignId: number,
  reason: string,
  delta: { sent: number; failed: number },
): Promise<number> {
  return inTransaction(db, async (tx) => {
    const unattempted = await tx
      .update(marketingCampaignSends)
      .set({ status: 'failed', error: reason.slice(0, 1_000) })
      .where(and(
        eq(marketingCampaignSends.campaignId, campaignId),
        eq(marketingCampaignSends.tenantId, tenantId),
        eq(marketingCampaignSends.status, 'queued'),
      ))
      .returning({ id: marketingCampaignSends.id });
    const abandoned = await tx
      .update(marketingCampaignSends)
      .set({ status: 'failed', error: STALE_CLAIM_ERROR })
      .where(and(
        eq(marketingCampaignSends.campaignId, campaignId),
        eq(marketingCampaignSends.tenantId, tenantId),
        eq(marketingCampaignSends.status, 'sending'),
      ))
      .returning({ id: marketingCampaignSends.id });
    const settledHere = unattempted.length + abandoned.length;
    await tx
      .update(marketingCampaigns)
      .set({
        status: 'failed',
        sent: sql`${marketingCampaigns.sent} + ${delta.sent}`,
        failed: sql`${marketingCampaigns.failed} + ${delta.failed + settledHere}`,
        completedAt: sql`NOW()`,
        updatedAt: sql`NOW()`,
      })
      .where(and(eq(marketingCampaigns.id, campaignId), eq(marketingCampaigns.tenantId, tenantId)));
    return settledHere;
  });
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
    const failedHere = await failCampaign(db, tenantId, campaignId, resolved.error, { sent: 0, failed: 0 });
    return { sent: 0, failed: failedHere, remaining: 0, status: 'failed' };
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
    // Least-attempted first, then id. The batch stops at the first no-response, so ordering by id
    // alone retries the same head row every tick through a long outage and writes it off at the
    // attempt ceiling before the next row gets a single try. This way every recipient gets one
    // attempt before any gets a second. No attempt is refunded: a timed-out send may have been
    // delivered, and a refund would allow unlimited duplicates.
    .orderBy(asc(marketingCampaignSends.attempts), asc(marketingCampaignSends.id))
    .limit(batchSize);

  let sent = 0;
  let failed = 0;

  // Do-not-contact, re-checked ONCE per batch. `startCampaign` applied the register when it
  // materialised the recipient rows, but a long send runs for hours across many batches, and
  // someone erased or unsubscribed in the meantime must not receive the rest of it. One statement
  // for the whole batch (both keys for an SMS, as at start), and a blocked row is settled straight
  // to `failed` WITHOUT being claimed: it is never sent, and spending an attempt on it would only
  // misstate how many times we tried to reach somebody we must not contact. One UPDATE settles them
  // all, and a row another runner got to first (no longer `queued`) is left alone and not counted.
  const batchChannel = campaign.channel === 'sms' ? 'sms' : 'email';
  const blockedKeys = queued.length > 0
    ? await suppressedEmails(db, tenantId, queued.flatMap((row) => campaignMemberKeys(batchChannel, row)))
    : new Set<string>();
  const blockedRows = queued.filter((row) => isMemberBlocked(blockedKeys, campaignMemberKeys(batchChannel, row)));
  if (blockedRows.length > 0) {
    const settledBlocked = await db
      .update(marketingCampaignSends)
      .set({ status: 'failed', error: DO_NOT_CONTACT_SEND_ERROR })
      .where(and(
        inArray(marketingCampaignSends.id, blockedRows.map((row) => row.id)),
        eq(marketingCampaignSends.campaignId, campaignId),
        eq(marketingCampaignSends.tenantId, tenantId),
        eq(marketingCampaignSends.status, 'queued'),
      ))
      .returning({ id: marketingCampaignSends.id });
    failed += settledBlocked.length;
  }
  const blockedIds = new Set(blockedRows.map((row) => row.id));

  // Set when a terminal SENDER failure (a revoked grant, a wrong key) ends the batch.
  let senderFailure: string | null = null;
  // Set when the provider is not serving us (no answer, a 429, a 5xx): the batch stops there (see below).
  let providerUnavailable = false;
  // The run of identical recipient-terminal failures that is the circuit breaker's evidence.
  let streak: { key: string; count: number } | null = null;

  for (const row of queued) {
    if (blockedIds.has(row.id)) continue;
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
    // The try covers the PROVIDER call and nothing else. A database error while recording an
    // ACCEPTED send is not a failed send: it must not be written back as `failed` (the message
    // was delivered), so the write-back below sits outside this try and a failure there leaves
    // the row `sending` for the stale-claim sweep ("delivery state unknown") and rethrows.
    let receipt: Awaited<ReturnType<typeof sender.send>>;
    try {
      // Materialisation only queues members with a usable number, so an empty
      // one here means the row was written before this campaign became an SMS.
      // Terminal by construction: no retry can invent a phone number.
      if (!to) throw new TransportError('No mobile number for this recipient.', false, 'recipient');
      receipt = await sender.send({
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
      // A provider that is not serving us (no answer, the call's timeout, a 429, a 5xx) will not
      // serve the next 24 either: each would cost an attempt, and a silent provider its full
      // timeout, so a small audience would be written off in three ticks of an outage. Stop the
      // batch here. The row just tried was requeued above (its attempt counts: it WAS tried); the
      // rest were never claimed, so they stay `queued` with no attempt consumed, and the next
      // batch retries them.
      if (error instanceof TransportError && error.providerUnavailable) {
        providerUnavailable = true;
        break;
      }
      // The circuit breaker. A sender fault the provider reports as a per-message 400 (a bad
      // From) reads as a recipient failure on every row. N identical ones in a row, with nothing
      // delivered by the CAMPAIGN so far, escalate to sender-level. A known per-recipient carrier
      // failure (a STOP, a landline, an invalid To) is identical across recipients by nature and
      // says nothing about the sender, so it never counts and resets the streak.
      const recipientTerminal = !requeue && !(error instanceof TransportError && error.retryable);
      if (settled.length > 0) {
        if (recipientTerminal && !(isSms && isPerRecipientCarrierFailure(message))) {
          const key = normalizeFailureMessage(message);
          streak = streak && streak.key === key ? { key, count: streak.count + 1 } : { key, count: 1 };
          if (campaign.sent + sent === 0 && streak.count >= SENDER_FAILURE_STREAK) {
            senderFailure = `${message} (the same failure on ${streak.count} recipients in a row with nothing delivered, `
              + 'so the sender is treated as unusable)';
            break;
          }
        } else {
          streak = null;
        }
      }
      continue;
    }

    // Conditional on the row still being `sending`: if the sweep reaped it while this runner
    // was in the transport call, the reaper has already counted it failed, and overwriting it
    // here would count it twice. A message that did go out for a reaped row is the "delivery
    // state unknown" the reaper's verdict already says.
    //
    // NOT inside the try above: if this write throws, the message WAS accepted, so the error
    // propagates (the sweep reports it and rotates the campaign) and the row stays `sending`
    // for the stale-claim sweep. Counters this batch had already earned are not lost for good:
    // the finishing update derives them from the ledger.
    const recorded = await db
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
    if (recorded.length > 0) sent += 1;
    streak = null;
  }

  if (senderFailure !== null) {
    const failedHere = await failCampaign(db, tenantId, campaignId, senderFailure, { sent, failed });
    return { sent, failed: failed + failedHere, remaining: 0, status: 'failed' };
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
  // The totals a FINISHED campaign reports are counted from the ledger, not accumulated from
  // batch deltas. A delta lives in one Worker invocation's memory: an evicted runner, or a batch
  // that threw after recording sends, leaves the campaign's counters short of the rows it actually
  // settled, and a total that is wrong is wrong for good. The send ledger is the source of truth
  // (`sent` and `failed` are the only terminal row states; opens, clicks and carrier delivery
  // status live in their own columns and never move a row off them, and an SMS the carrier later
  // reports undelivered is flipped sent -> failed in the ledger as well as on the counters), so
  // counting its rows makes the final number correct by construction. Non-final batches keep the
  // cheap delta: nothing reads those totals as final, and the finishing update replaces them.
  const ledgerCount = (rowStatus: 'sent' | 'failed') => sql`(SELECT count(*)::int FROM ${marketingCampaignSends}
    WHERE ${marketingCampaignSends.campaignId} = ${marketingCampaigns.id}
      AND ${marketingCampaignSends.tenantId} = ${marketingCampaigns.tenantId}
      AND ${marketingCampaignSends.status} = ${rowStatus})`;
  const sentTotal = done ? ledgerCount('sent') : sql`${marketingCampaigns.sent} + ${sent}`;
  const failedTotal = done ? ledgerCount('failed') : sql`${marketingCampaigns.failed} + ${failed}`;
  // The flip to a finished status is conditional on the campaign still being `sending`, so a
  // concurrent batch that failed it (a dead sender) is never overwritten with `sent`; the
  // counters land either way. A campaign that finishes having delivered nothing, with rows
  // failed, did not "send": it reads `failed`. Both tests read the same ledger counts the
  // counters are set from.
  const finishedStatus = sql`CASE WHEN ${marketingCampaigns.status} <> 'sending' THEN ${marketingCampaigns.status}
    WHEN ${ledgerCount('sent')} = 0 AND ${ledgerCount('failed')} > 0 THEN 'failed'
    ELSE 'sent' END`;
  const [finished] = await db
    .update(marketingCampaigns)
    .set({
      sent: sentTotal,
      failed: failedTotal,
      ...(done
        ? {
            status: finishedStatus,
            completedAt: sql`CASE WHEN ${marketingCampaigns.status} = 'sending' THEN NOW() ELSE ${marketingCampaigns.completedAt} END`,
          }
        : {}),
      updatedAt: sql`NOW()`,
    })
    .where(and(eq(marketingCampaigns.id, campaignId), eq(marketingCampaigns.tenantId, tenantId)))
    .returning({ status: marketingCampaigns.status });
  // What the campaign now reads. Falls back to this batch's own view only if the row did not come back.
  const finalStatus = finished?.status ?? (done ? (sent === 0 && failed > 0 ? 'failed' : 'sent') : 'sending');

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

  return {
    sent,
    failed,
    remaining: Number(remaining),
    status: finalStatus,
    ...(providerUnavailable ? { stopped: 'provider_unavailable' as const } : {}),
  };
}
