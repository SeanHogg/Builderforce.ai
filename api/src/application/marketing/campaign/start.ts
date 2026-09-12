/**
 * Starting a campaign — the pre-flight that decides whether it may send at all,
 * and the materialized recipient list. Split out of `../campaignEngine.ts`, which
 * re-exports it.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { Env } from '../../../env';
import type { Db } from '../../../infrastructure/database/connection';
import {
  marketingAudienceMembers,
  marketingCampaignSends,
  marketingCampaigns,
  marketingSenderIdentities,
} from '../../../infrastructure/database/schema';
import { newChallengeToken } from '../../shared/dnsVerification';
import {
  isCampaignChannel,
  isE164,
  resolveCampaignSender,
  type CampaignChannel,
} from '../campaignTransports';
import { suppressedSubset } from './audiences';
import { CAMPAIGN_COLUMNS, type CampaignView } from './campaigns';

export type StartResult =
  | {
      ok: true; campaign: CampaignView; queued: number; suppressed: number;
      /** Members this CHANNEL cannot reach — no mobile number, or a carrier STOP.
       *  Always 0 for email, where the address is the audience's own key. */
      unreachable: number;
    }
  | { ok: false; status: 400 | 404 | 409; error: string };

/**
 * Load a campaign's transport binding.
 *
 * ONE loader, used by both `startCampaign` (to refuse an unsendable campaign
 * before a single recipient row exists) and `runCampaignBatch` (to resolve the
 * sender for each batch). Two readers of the same binding is how "it let me
 * start and then failed every message" happens.
 */
export async function loadTransportBinding(db: Db, tenantId: number, campaignId: number) {
  const [row] = await db
    .select({
      id: marketingCampaigns.id,
      status: marketingCampaigns.status,
      subject: marketingCampaigns.subject,
      bodyHtml: marketingCampaigns.bodyHtml,
      bodyText: marketingCampaigns.bodyText,
      channel: marketingCampaigns.channel,
      audienceId: marketingCampaigns.audienceId,
      transport: marketingCampaigns.transport,
      mailboxConnectionId: marketingCampaigns.mailboxConnectionId,
      connectorConnectionId: marketingCampaigns.connectorConnectionId,
      fromName: marketingCampaigns.fromName,
      fromNumber: marketingCampaigns.fromNumber,
      senderIdentityId: marketingCampaigns.senderIdentityId,
      senderFromEmail: marketingSenderIdentities.fromEmail,
      senderFromName: marketingSenderIdentities.fromName,
      senderStatus: marketingSenderIdentities.status,
    })
    .from(marketingCampaigns)
    // LEFT join: a mailbox campaign has no sender identity at all, and an inner
    // join would make it invisible to its own send engine.
    .leftJoin(marketingSenderIdentities, and(
      eq(marketingSenderIdentities.id, marketingCampaigns.senderIdentityId),
      eq(marketingSenderIdentities.tenantId, tenantId),
    ))
    .where(and(eq(marketingCampaigns.id, campaignId), eq(marketingCampaigns.tenantId, tenantId)))
    .limit(1);
  if (!row) return null;
  return {
    ...row,
    binding: {
      transport: row.transport,
      channel: row.channel,
      senderIdentity: row.senderFromEmail
        ? { fromEmail: row.senderFromEmail, fromName: row.senderFromName ?? '', status: row.senderStatus ?? '' }
        : null,
      mailboxConnectionId: row.mailboxConnectionId,
      connectorConnectionId: row.connectorConnectionId,
      fromName: row.fromName,
      fromNumber: row.fromNumber,
    },
  };
}

/**
 * What a campaign of this channel must have before it can start.
 *
 * ONE predicate, called by `startCampaign` — so "an SMS campaign needs a body"
 * cannot be enforced by the REST route and forgotten by the scheduled sweep,
 * which is exactly the class of bug a second scheduling entry point introduces.
 */
function contentProblem(channel: CampaignChannel, campaign: { subject: string; bodyText: string }): string | null {
  if (channel === 'sms') {
    return campaign.bodyText.trim() ? null : 'Write the text message before sending.';
  }
  return campaign.subject.trim() ? null : 'Add a subject line before sending.';
}

/**
 * Materialize the recipient list and move the campaign to `sending`.
 *
 * Every precondition that protects a real person is checked here rather than at
 * send time, so a campaign either cannot start or is safe to run to completion:
 * a resolvable sender (whichever transport it uses), a subject, a non-empty
 * audience, and suppression applied before a single message exists.
 */
export async function startCampaign(
  env: Env,
  db: Db,
  tenantId: number,
  campaignId: number,
): Promise<StartResult> {
  const campaign = await loadTransportBinding(db, tenantId, campaignId);
  if (!campaign) return { ok: false, status: 404, error: 'Campaign not found.' };
  if (campaign.status !== 'draft') {
    return { ok: false, status: 409, error: `This campaign is already ${campaign.status}.` };
  }
  const channel: CampaignChannel = isCampaignChannel(campaign.channel) ? campaign.channel : 'email';
  const missing = contentProblem(channel, campaign);
  if (missing) return { ok: false, status: 400, error: missing };

  // Whichever transport this campaign uses, it must resolve NOW — the whole
  // point of the pre-flight is that a started campaign is safe to finish.
  const resolved = await resolveCampaignSender(db, env, tenantId, campaign.binding);
  if (!resolved.ok) return { ok: false, status: 400, error: resolved.error };

  const members = await db
    .select({
      email: marketingAudienceMembers.email,
      phone: marketingAudienceMembers.phone,
      phoneStatus: marketingAudienceMembers.phoneStatus,
    })
    .from(marketingAudienceMembers)
    .where(and(
      eq(marketingAudienceMembers.audienceId, campaign.audienceId),
      eq(marketingAudienceMembers.tenantId, tenantId),
      eq(marketingAudienceMembers.status, 'subscribed'),
    ));
  if (members.length === 0) {
    return { ok: false, status: 400, error: 'This audience has no subscribed members.' };
  }

  // An SMS can only reach a member who HAS a number and has not texted STOP.
  // Reported as `unreachable` rather than folded into `suppressed`: "we have no
  // number for them" and "they asked us to stop" are different facts, and a list
  // owner can act on the first one.
  const reachable = channel === 'sms'
    ? members.filter((m) => isE164(m.phone) && m.phoneStatus === 'subscribed')
    : members;
  if (reachable.length === 0) {
    return {
      ok: false,
      status: 400,
      error: 'No member of this audience has a mobile number we can text.',
    };
  }

  // The tenant-wide suppression list is a DO-NOT-CONTACT list, so it blocks both
  // channels. A carrier STOP is narrower and only sets `phone_status` — it is a
  // withdrawal of SMS consent specifically, and treating it as an email opt-out
  // would silently unsubscribe somebody from a newsletter they still want.
  const blocked = await suppressedSubset(db, tenantId, reachable.map((m) => m.email));
  const deliverable = reachable.filter((m) => !blocked.has(m.email));
  if (deliverable.length === 0) {
    return { ok: false, status: 400, error: 'Every member of this audience has unsubscribed.' };
  }

  await db
    .insert(marketingCampaignSends)
    .values(deliverable.map((member) => ({
      campaignId,
      tenantId,
      email: member.email,
      // Stamped at materialisation, not read at send time: the ledger has to
      // describe the number this campaign actually messaged.
      phone: channel === 'sms' ? member.phone : null,
      status: 'queued',
      trackToken: newChallengeToken(),
    })))
    // Idempotent: re-starting cannot duplicate a recipient.
    .onConflictDoNothing();

  const [updated] = await db
    .update(marketingCampaigns)
    .set({
      status: 'sending',
      startedAt: sql`NOW()`,
      recipients: deliverable.length,
      suppressed: blocked.size,
      updatedAt: sql`NOW()`,
    })
    .where(and(eq(marketingCampaigns.id, campaignId), eq(marketingCampaigns.tenantId, tenantId)))
    .returning(CAMPAIGN_COLUMNS);

  return {
    ok: true,
    campaign: updated!,
    queued: deliverable.length,
    suppressed: blocked.size,
    unreachable: members.length - reachable.length,
  };
}
