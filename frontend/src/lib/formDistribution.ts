/**
 * Form → campaign. Send writes a `marketing_campaign` and fires it; Post writes
 * a `social_campaign` and publishes it. No second survey store, no fifth contact
 * list — the growth and social rails already exist, and a form that cannot reach
 * them is the gap PRD 27 B3 closes.
 *
 * Named-recipient Send keeps the per-recipient `?t=` token (FR-6.2) by putting
 * the tokenised URL on each audience member as `formUrl` and merging `{{formUrl}}`
 * in the body. Anyone-with-the-link Send uses the public share URL as-is.
 *
 * Blockers are the same `CAMPAIGN_BLOCKERS` / social `blockers` the growth and
 * social surfaces already show — surfaced here BEFORE send (FR-6.1), never after.
 */

import {
  campaignBlockers, growthApi,
  type Campaign, type CampaignBlocker, type CampaignTransport, type SenderIdentity,
} from './growthApi';
import { mailboxApi } from './mailboxApi';
import { socialApi, type SocialCampaignBlocker } from './socialApi';
import { formRecipientUrl } from './formObject';

export interface SendFormInput {
  title: string;
  shareUrl: string;
  audience: string;
  recipients: Array<{ email: string; name?: string }>;
  invitations?: Array<{ email: string; name?: string; token: string }>;
  marketingAudienceId?: number;
}

export type SendFormResult =
  | { ok: true; campaignId: number; queued: number }
  | { ok: false; reason: 'unpublished' | 'noAudience' | 'blocked'; blockers?: CampaignBlocker[]; campaignId?: number };

export interface PostFormInput {
  title: string;
  shareUrl: string;
  sessionId?: string;
}

export type PostFormResult =
  | { ok: true; campaignId: number; published: number }
  | { ok: false; reason: 'unpublished' | 'blocked'; blockers?: SocialCampaignBlocker[]; campaignId?: number };

export function formCampaignSubject(title: string): string {
  const t = title.trim() || 'this form';
  return `Would you answer ${t}?`;
}

export function formSocialBody(title: string, shareUrl: string): string {
  const t = title.trim() || 'this form';
  return `Would you answer ${t}? ${shareUrl}`;
}

export function formCampaignBodyHtml(opts: { title: string; shareUrl: string; named: boolean }): string {
  const title = escapeHtml(opts.title.trim() || 'form');
  const href = opts.named ? '{{formUrl}}' : escapeHtml(opts.shareUrl);
  const fallback = opts.named ? '{{formUrl}}' : escapeHtml(opts.shareUrl);
  return `<p>Please answer <a href="${href}">${title}</a>.</p><p>${fallback}</p>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function invitationMembers(input: SendFormInput): Array<{ email: string; name?: string; attributes?: Record<string, unknown> }> {
  if (input.invitations?.length) {
    return input.invitations.map((inv) => ({
      email: inv.email,
      ...(inv.name ? { name: inv.name } : {}),
      attributes: {
        formUrl: formRecipientUrl(input.shareUrl, inv.token),
        formToken: inv.token,
      },
    }));
  }
  if (input.audience === 'namedRecipients' && input.recipients.length) {
    return input.recipients.map((row) => ({
      email: row.email,
      ...(row.name ? { name: row.name } : {}),
      attributes: { formUrl: input.shareUrl },
    }));
  }
  return [];
}

async function resolveAudience(input: SendFormInput) {
  const { audiences } = await growthApi.listAudiences();
  const members = invitationMembers(input);
  if (input.marketingAudienceId) {
    const found = audiences.find((entry) => entry.id === input.marketingAudienceId);
    if (!found) return null;
    if (members.length) await growthApi.addMembers(found.id, members);
    const after = (await growthApi.listAudiences()).audiences.find((entry) => entry.id === found.id);
    return after ?? { ...found, memberCount: found.memberCount + members.length };
  }
  if (members.length === 0) return null;
  const created = await growthApi.createAudience({ name: input.title.trim() || 'Form' });
  await growthApi.addMembers(created.id, members);
  return { ...created, memberCount: members.length };
}

async function resolveSendIdentity(): Promise<{
  transport: CampaignTransport;
  senderIdentityId?: number;
  mailboxConnectionId?: number;
  senders: SenderIdentity[];
  mailboxes: Array<{ id: number; status: string; allowSending: boolean }>;
}> {
  const [{ senders }, mailbox] = await Promise.all([
    growthApi.listSenders(),
    mailboxApi.providers().catch(() => ({ connections: [] as Array<{ id: number; status: string; allowSending: boolean }> })),
  ]);
  const mailboxes = mailbox.connections ?? [];
  const mailboxReady = mailboxes.find((entry) => entry.status === 'connected' && entry.allowSending);
  if (mailboxReady) {
    return { transport: 'mailbox', mailboxConnectionId: mailboxReady.id, senders, mailboxes };
  }
  const sender = senders.find((entry) => entry.status === 'verified');
  return { transport: 'platform', senderIdentityId: sender?.id, senders, mailboxes };
}

export async function sendForm(input: SendFormInput): Promise<SendFormResult> {
  if (!input.shareUrl) return { ok: false, reason: 'unpublished' };
  const [audience, identity] = await Promise.all([resolveAudience(input), resolveSendIdentity()]);
  if (!audience) return { ok: false, reason: 'noAudience' };
  const named = (input.invitations?.length ?? 0) > 0
    || (input.audience === 'namedRecipients' && input.recipients.length > 0);
  const campaign: Campaign = await growthApi.createCampaign({
    name: input.title.trim() || 'Form',
    audienceId: audience.id,
    subject: formCampaignSubject(input.title),
    bodyHtml: formCampaignBodyHtml({ title: input.title, shareUrl: input.shareUrl, named }),
    transport: identity.transport,
    ...(identity.senderIdentityId ? { senderIdentityId: identity.senderIdentityId } : {}),
    ...(identity.mailboxConnectionId ? { mailboxConnectionId: identity.mailboxConnectionId } : {}),
  });
  const blockers = campaignBlockers(campaign, identity.senders, [audience], identity.mailboxes);
  if (blockers.length) return { ok: false, reason: 'blocked', blockers, campaignId: campaign.id };
  const sent = await growthApi.send(campaign.id);
  return { ok: true, campaignId: campaign.id, queued: sent.queued };
}

export async function postForm(input: PostFormInput): Promise<PostFormResult> {
  if (!input.shareUrl) return { ok: false, reason: 'unpublished' };
  const created = await socialApi.createCampaign({
    name: input.title.trim() || 'Form',
    body: formSocialBody(input.title, input.shareUrl),
    linkUrl: input.shareUrl,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
  });
  if (created.campaign.blockers.length) {
    return {
      ok: false,
      reason: 'blocked',
      blockers: created.campaign.blockers,
      campaignId: created.campaign.id,
    };
  }
  const batch = await socialApi.publishCampaign(created.campaign.id);
  return { ok: true, campaignId: created.campaign.id, published: batch.published };
}
