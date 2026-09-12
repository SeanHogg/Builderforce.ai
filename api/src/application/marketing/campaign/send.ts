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

/** How many recipients one batch attempts. Bounded by the Worker's subrequest
 *  budget, not by taste — each send is one outbound HTTP call. */
export const SEND_BATCH_SIZE = 25;

/**
 * How many times one recipient may be attempted before it is written off.
 *
 * A retryable failure (a 429, a provider 5xx) returns the send row to `queued`
 * so the next sweep picks it up — which means an error we MISCLASSIFIED as
 * retryable would requeue forever and the campaign would never reach `sent`.
 * This is the bound that makes the requeue safe. Three is enough to ride out a
 * rate limit and few enough that a genuinely broken transport surfaces within a
 * couple of sweeps.
 */
export const CAMPAIGN_SEND_MAX_ATTEMPTS = 3;

export interface BatchResult {
  sent: number;
  failed: number;
  remaining: number;
  status: string;
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
  if (!campaign || campaign.status !== 'sending') {
    return { sent: 0, failed: 0, remaining: 0, status: campaign?.status ?? 'missing' };
  }

  const resolved = await resolveCampaignSender(db, env, tenantId, campaign.binding);
  if (!resolved.ok) {
    // The transport that passed pre-flight has since broken (mailbox revoked,
    // sender un-verified, connection deleted). Every remaining recipient would
    // fail identically, so the campaign fails as a whole and says why — rather
    // than grinding through the audience writing the same error N times.
    await db
      .update(marketingCampaigns)
      .set({ status: 'failed', completedAt: sql`NOW()`, updatedAt: sql`NOW()` })
      .where(and(eq(marketingCampaigns.id, campaignId), eq(marketingCampaigns.tenantId, tenantId)));
    await db
      .update(marketingCampaignSends)
      .set({ status: 'failed', error: resolved.error.slice(0, 1_000) })
      .where(and(
        eq(marketingCampaignSends.campaignId, campaignId),
        eq(marketingCampaignSends.tenantId, tenantId),
        eq(marketingCampaignSends.status, 'queued'),
      ));
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

  for (const row of queued) {
    // Claim: only the runner whose UPDATE matches gets to send this one. The
    // attempt is counted AT CLAIM TIME, not on failure — a runner that dies
    // mid-send (a Worker eviction) would otherwise leave the row claimable
    // forever with its counter untouched.
    const claimed = await db
      .update(marketingCampaignSends)
      .set({ status: 'sending', attempts: sql`${marketingCampaignSends.attempts} + 1` })
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
      if (!to) throw new TransportError('No mobile number for this recipient.', false);
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
      await db
        .update(marketingCampaignSends)
        .set({
          status: 'sent',
          sentAt: sql`NOW()`,
          error: null,
          ...(receipt.externalId ? { externalMessageId: receipt.externalId } : {}),
        })
        .where(and(eq(marketingCampaignSends.id, row.id), eq(marketingCampaignSends.tenantId, tenantId)));
      sent += 1;
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
      const exhausted = row.attempts + 1 >= CAMPAIGN_SEND_MAX_ATTEMPTS;
      const requeue = error instanceof TransportError && error.retryable && !exhausted;
      await db
        .update(marketingCampaignSends)
        .set({ status: requeue ? 'queued' : 'failed', error: message.slice(0, 1_000) })
        .where(and(eq(marketingCampaignSends.id, row.id), eq(marketingCampaignSends.tenantId, tenantId)));
      if (!requeue) failed += 1;
      reportCaughtError(error, { source: 'application/marketing/campaign/send.ts', operation: 'runCampaignBatch' });
      // A terminal transport failure means every remaining recipient fails the
      // same way; stop the batch rather than working through the audience.
      if (error instanceof TransportError && !error.retryable) break;
    }
  }

  const [{ remaining } = { remaining: 0 }] = await db
    .select({ remaining: sql<number>`count(*)::int` })
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

  return { sent, failed, remaining: Number(remaining), status: done ? 'sent' : 'sending' };
}
