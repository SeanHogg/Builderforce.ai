/**
 * Campaign records — list, create and edit a draft. Starting and sending live in
 * `./start.ts` and `./send.ts`. Split out of `../campaignEngine.ts`, which
 * re-exports it.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../../../infrastructure/database/connection';
import { marketingAudiences, marketingCampaigns } from '../../../infrastructure/database/schema';
import {
  DEFAULT_TRANSPORT,
  isCampaignChannel,
  isCampaignTransport,
  transportSuitsChannel,
  type CampaignChannel,
  type CampaignTransport,
} from '../campaignTransports';
import { getTemplate } from '../templateLibrary';
import { SMS_BODY_MAX_CHARS } from './render';

// ---------------------------------------------------------------------------
// Campaign lifecycle
// ---------------------------------------------------------------------------

export interface CampaignView {
  id: number;
  name: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  status: string;
  channel: string;
  audienceId: number;
  senderIdentityId: number | null;
  transport: string;
  mailboxConnectionId: number | null;
  connectorConnectionId: string | null;
  templateId: number | null;
  fromName: string;
  fromNumber: string | null;
  scheduledAt: Date | null;
  projectId: number | null;
  recipients: number;
  sent: number;
  failed: number;
  suppressed: number;
  opened: number;
  clicked: number;
  startedAt: Date | null;
  completedAt: Date | null;
  updatedAt: Date;
}

export const CAMPAIGN_COLUMNS = {
  id: marketingCampaigns.id,
  name: marketingCampaigns.name,
  subject: marketingCampaigns.subject,
  bodyHtml: marketingCampaigns.bodyHtml,
  bodyText: marketingCampaigns.bodyText,
  status: marketingCampaigns.status,
  channel: marketingCampaigns.channel,
  audienceId: marketingCampaigns.audienceId,
  senderIdentityId: marketingCampaigns.senderIdentityId,
  transport: marketingCampaigns.transport,
  mailboxConnectionId: marketingCampaigns.mailboxConnectionId,
  connectorConnectionId: marketingCampaigns.connectorConnectionId,
  templateId: marketingCampaigns.templateId,
  fromName: marketingCampaigns.fromName,
  fromNumber: marketingCampaigns.fromNumber,
  scheduledAt: marketingCampaigns.scheduledAt,
  projectId: marketingCampaigns.projectId,
  recipients: marketingCampaigns.recipients,
  sent: marketingCampaigns.sent,
  failed: marketingCampaigns.failed,
  suppressed: marketingCampaigns.suppressed,
  opened: marketingCampaigns.opened,
  clicked: marketingCampaigns.clicked,
  startedAt: marketingCampaigns.startedAt,
  completedAt: marketingCampaigns.completedAt,
  updatedAt: marketingCampaigns.updatedAt,
} as const;

export async function listCampaigns(db: Db, tenantId: number): Promise<CampaignView[]> {
  return db
    .select(CAMPAIGN_COLUMNS)
    .from(marketingCampaigns)
    .where(eq(marketingCampaigns.tenantId, tenantId))
    .orderBy(sql`${marketingCampaigns.updatedAt} DESC`);
}

export type CampaignResult =
  | { ok: true; campaign: CampaignView }
  | { ok: false; status: 400 | 404 | 409; error: string };

export async function createCampaign(
  db: Db,
  tenantId: number,
  input: {
    name: string; audienceId: number; subject?: string; bodyHtml?: string; bodyText?: string;
    senderIdentityId?: number | null; projectId?: number | null; sessionId?: string | null;
    channel?: CampaignChannel;
    transport?: CampaignTransport; mailboxConnectionId?: number | null;
    connectorConnectionId?: string | null; templateId?: number | null; fromName?: string;
    fromNumber?: string | null; scheduledAt?: Date | null;
  },
): Promise<CampaignResult> {
  const [audience] = await db
    .select({ id: marketingAudiences.id })
    .from(marketingAudiences)
    .where(and(eq(marketingAudiences.id, input.audienceId), eq(marketingAudiences.tenantId, tenantId)))
    .limit(1);
  if (!audience) return { ok: false, status: 400, error: 'Pick an audience that belongs to this workspace.' };

  // The channel decides which transports are even legal, so it is resolved before
  // the transport rather than validated against it afterwards — a caller that
  // names neither gets a platform email, which is what every existing caller means.
  const channel: CampaignChannel = input.channel ?? 'email';
  const transport: CampaignTransport = input.transport ?? DEFAULT_TRANSPORT[channel];
  if (!transportSuitsChannel(channel, transport)) {
    return { ok: false, status: 400, error: `A ${channel} campaign cannot send through ${transport}.` };
  }

  // A template supplies the subject and body the author did not type. COPIED in
  // rather than referenced at send time: editing a template must not silently
  // rewrite a campaign that was already reviewed and approved.
  let subject = (input.subject ?? '').slice(0, 500);
  let bodyHtml = input.bodyHtml ?? '';
  if (input.templateId != null) {
    const template = await getTemplate(db, tenantId, input.templateId);
    if (!template) return { ok: false, status: 400, error: 'That template belongs to another workspace.' };
    if (!subject.trim()) subject = template.subject;
    if (!bodyHtml.trim()) bodyHtml = template.bodyHtml;
  }

  const [row] = await db
    .insert(marketingCampaigns)
    .values({
      tenantId,
      audienceId: input.audienceId,
      senderIdentityId: input.senderIdentityId ?? null,
      channel,
      transport,
      mailboxConnectionId: input.mailboxConnectionId ?? null,
      connectorConnectionId: input.connectorConnectionId ?? null,
      templateId: input.templateId ?? null,
      fromName: (input.fromName ?? '').slice(0, 255),
      fromNumber: (input.fromNumber ?? '').trim() || null,
      scheduledAt: input.scheduledAt ?? null,
      projectId: input.projectId ?? null,
      sessionId: input.sessionId ?? null,
      name: input.name.trim().slice(0, 255) || 'Campaign',
      subject,
      bodyHtml,
      bodyText: (input.bodyText ?? '').slice(0, SMS_BODY_MAX_CHARS),
    })
    .returning(CAMPAIGN_COLUMNS);
  return { ok: true, campaign: row! };
}

export async function updateCampaign(
  db: Db,
  tenantId: number,
  campaignId: number,
  patch: {
    name?: string; subject?: string; bodyHtml?: string; bodyText?: string;
    senderIdentityId?: number | null; channel?: CampaignChannel;
    audienceId?: number; transport?: CampaignTransport; mailboxConnectionId?: number | null;
    connectorConnectionId?: string | null; templateId?: number | null; fromName?: string;
    fromNumber?: string | null; scheduledAt?: Date | null;
  },
): Promise<CampaignResult> {
  const set: Record<string, unknown> = { updatedAt: sql`NOW()` };
  if (typeof patch.name === 'string') set.name = patch.name.trim().slice(0, 255);
  if (typeof patch.subject === 'string') set.subject = patch.subject.slice(0, 500);
  if (typeof patch.bodyHtml === 'string') set.bodyHtml = patch.bodyHtml;
  if (typeof patch.bodyText === 'string') set.bodyText = patch.bodyText.slice(0, SMS_BODY_MAX_CHARS);
  if (patch.senderIdentityId !== undefined) set.senderIdentityId = patch.senderIdentityId;
  if (typeof patch.audienceId === 'number') set.audienceId = patch.audienceId;
  if (isCampaignChannel(patch.channel)) set.channel = patch.channel;
  if (isCampaignTransport(patch.transport)) set.transport = patch.transport;
  if (patch.mailboxConnectionId !== undefined) set.mailboxConnectionId = patch.mailboxConnectionId;
  if (patch.connectorConnectionId !== undefined) set.connectorConnectionId = patch.connectorConnectionId;
  if (patch.templateId !== undefined) set.templateId = patch.templateId;
  if (typeof patch.fromName === 'string') set.fromName = patch.fromName.slice(0, 255);
  if (patch.fromNumber !== undefined) set.fromNumber = (patch.fromNumber ?? '').trim() || null;
  if (patch.scheduledAt !== undefined) set.scheduledAt = patch.scheduledAt;

  // Channel and transport are set by two different calls, so a patch that moves
  // only ONE of them can leave a row no transport can serve. Validating the
  // MERGED pair — which costs a read on an edit, and edits are rare while sends
  // are not — is what stops that row existing at all, rather than being caught
  // later by a send that refuses.
  if (set.channel !== undefined || set.transport !== undefined) {
    const [current] = await db
      .select({ channel: marketingCampaigns.channel, transport: marketingCampaigns.transport })
      .from(marketingCampaigns)
      .where(and(eq(marketingCampaigns.id, campaignId), eq(marketingCampaigns.tenantId, tenantId)))
      .limit(1);
    if (!current) return { ok: false, status: 404, error: 'Campaign not found.' };
    const channel = (set.channel as CampaignChannel | undefined)
      ?? (isCampaignChannel(current.channel) ? current.channel : 'email');
    // A channel change with no transport change moves the transport with it —
    // asking the caller to restate the only legal value would be ceremony.
    const transport = (set.transport as CampaignTransport | undefined)
      ?? (set.channel !== undefined ? DEFAULT_TRANSPORT[channel]
        : isCampaignTransport(current.transport) ? current.transport : DEFAULT_TRANSPORT[channel]);
    if (!transportSuitsChannel(channel, transport)) {
      return { ok: false, status: 400, error: `A ${channel} campaign cannot send through ${transport}.` };
    }
    set.transport = transport;
  }

  const [row] = await db
    .update(marketingCampaigns)
    .set(set)
    .where(and(
      eq(marketingCampaigns.id, campaignId),
      eq(marketingCampaigns.tenantId, tenantId),
      // A campaign that is sending or sent is a historical record; editing the
      // body after the fact would make the send ledger describe a message that
      // was never delivered.
      eq(marketingCampaigns.status, 'draft'),
    ))
    .returning(CAMPAIGN_COLUMNS);
  if (!row) return { ok: false, status: 409, error: 'Only a draft campaign can be edited.' };
  return { ok: true, campaign: row! };
}
