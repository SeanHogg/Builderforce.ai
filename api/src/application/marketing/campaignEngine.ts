/**
 * Tenant marketing — audiences, verified senders, suppression, and a real send
 * engine.
 *
 * What was here before: `sales_campaigns` (migration 0401), which is the
 * Builderforce referral team's own CRM — scoped to a USER, with `sent`/`replies`
 * as integers a human types in — and `MarketingService`, which is our own
 * marketing-site visitor telemetry. Neither let a TENANT contact the people who
 * signed up on the site they just built. This is that engine.
 *
 * FOUR THINGS IT REFUSES TO DO, BY CONSTRUCTION
 *  1. Send from a domain the tenant has not proven they own. A campaign without
 *     a `verified` sender identity cannot start (`startCampaign` rejects it),
 *     and ownership is a DNS TXT proof, not a checkbox.
 *  2. Email someone who opted out. Suppression is tenant-wide and evaluated at
 *     send time, so re-importing a list cannot resurrect an unsubscribed person.
 *  3. Email the same person twice. `marketing_campaign_sends` is unique on
 *     (campaign, email), so materializing is idempotent and a resumed or
 *     retried run skips what already went out.
 *  4. Send without a way out. Every message gets a working one-click
 *     unsubscribe link — appended by the renderer, not by the author, so it
 *     cannot be forgotten or removed.
 *
 * Sends run in BATCHES driven by the caller (a route for "send now", the cron
 * sweep for scheduled and resumed runs), because a Worker invocation cannot hold
 * a long loop and a partial send must be resumable.
 */

import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import {
  marketingAudienceMembers,
  marketingAudiences,
  marketingCampaignSends,
  marketingCampaigns,
  marketingSenderIdentities,
  marketingSuppressions,
} from '../../infrastructure/database/schema';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import {
  emailDomain,
  isSendableEmail,
  newChallengeToken,
  normalizeEmail,
  verifyChallengeToken,
  type DnsLookupDeps,
} from '../shared/dnsVerification';
import {
  isCampaignTransport,
  resolveCampaignSender,
  TransportError,
  type CampaignTransport,
} from './campaignTransports';
import { defaultLogoUrl, getTemplate, resolveAssetOrigin } from './templateLibrary';

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

// ---------------------------------------------------------------------------
// Audiences
// ---------------------------------------------------------------------------

export interface AudienceView {
  id: number;
  name: string;
  description: string;
  memberCount: number;
  projectId: number | null;
  updatedAt: Date;
}

export async function listAudiences(db: Db, tenantId: number): Promise<AudienceView[]> {
  return db
    .select({
      id: marketingAudiences.id,
      name: marketingAudiences.name,
      description: marketingAudiences.description,
      memberCount: marketingAudiences.memberCount,
      projectId: marketingAudiences.projectId,
      updatedAt: marketingAudiences.updatedAt,
    })
    .from(marketingAudiences)
    .where(eq(marketingAudiences.tenantId, tenantId))
    .orderBy(sql`${marketingAudiences.updatedAt} DESC`);
}

export async function createAudience(
  db: Db,
  tenantId: number,
  input: { name: string; description?: string; projectId?: number | null },
): Promise<AudienceView> {
  const [row] = await db
    .insert(marketingAudiences)
    .values({
      tenantId,
      name: input.name.trim().slice(0, 255) || 'Audience',
      description: (input.description ?? '').slice(0, 2_000),
      projectId: input.projectId ?? null,
    })
    .returning({
      id: marketingAudiences.id,
      name: marketingAudiences.name,
      description: marketingAudiences.description,
      memberCount: marketingAudiences.memberCount,
      projectId: marketingAudiences.projectId,
      updatedAt: marketingAudiences.updatedAt,
    });
  return row!;
}

export interface AudienceMemberInput {
  email: string;
  name?: string;
  source?: string;
  attributes?: Record<string, unknown>;
}

/**
 * Add or refresh audience members. Returns how many were genuinely new so the
 * caller can report "12 added, 3 already there" rather than a meaningless total.
 *
 * Re-adding an UNSUBSCRIBED member deliberately does NOT resubscribe them: the
 * `status` column is left alone on conflict. Importing a list must never undo
 * someone's opt-out.
 */
export async function addAudienceMembers(
  db: Db,
  tenantId: number,
  audienceId: number,
  members: AudienceMemberInput[],
): Promise<{ added: number; updated: number; rejected: number }> {
  const [audience] = await db
    .select({ id: marketingAudiences.id })
    .from(marketingAudiences)
    .where(and(eq(marketingAudiences.id, audienceId), eq(marketingAudiences.tenantId, tenantId)))
    .limit(1);
  if (!audience) return { added: 0, updated: 0, rejected: members.length };

  const seen = new Set<string>();
  const rows: Array<typeof marketingAudienceMembers.$inferInsert> = [];
  let rejected = 0;
  for (const member of members) {
    if (!isSendableEmail(member.email)) {
      rejected += 1;
      continue;
    }
    const email = normalizeEmail(member.email);
    // De-duplicate WITHIN the batch too: Postgres rejects an ON CONFLICT insert
    // that touches the same key twice in one statement.
    if (seen.has(email)) continue;
    seen.add(email);
    rows.push({
      audienceId,
      tenantId,
      email,
      name: (member.name ?? '').slice(0, 255),
      source: (member.source ?? 'manual').slice(0, 32),
      attributes: member.attributes ?? {},
    });
  }
  if (rows.length === 0) return { added: 0, updated: 0, rejected };

  const inserted = await db
    .insert(marketingAudienceMembers)
    .values(rows)
    .onConflictDoUpdate({
      target: [marketingAudienceMembers.audienceId, marketingAudienceMembers.email],
      set: { name: sql`excluded.name`, updatedAt: sql`NOW()` },
    })
    // `xmax = 0` is true only for a freshly-inserted row, so this distinguishes
    // a real add from an update without a second round-trip.
    .returning({ id: marketingAudienceMembers.id, isNew: sql<boolean>`(xmax = 0)` });

  const added = inserted.filter((r) => r.isNew).length;
  await refreshAudienceCount(db, tenantId, audienceId);
  return { added, updated: inserted.length - added, rejected };
}

/** Recompute the denormalized subscribed count. One statement, no read-back. */
export async function refreshAudienceCount(db: Db, tenantId: number, audienceId: number): Promise<void> {
  await db
    .update(marketingAudiences)
    .set({
      memberCount: sql`(
        SELECT COUNT(*)::int FROM ${marketingAudienceMembers}
        WHERE ${marketingAudienceMembers.audienceId} = ${audienceId}
          AND ${marketingAudienceMembers.status} = 'subscribed'
      )`,
      updatedAt: sql`NOW()`,
    })
    .where(and(eq(marketingAudiences.id, audienceId), eq(marketingAudiences.tenantId, tenantId)));
}

// ---------------------------------------------------------------------------
// Sender identities
// ---------------------------------------------------------------------------

export interface SenderView {
  id: number;
  fromEmail: string;
  fromName: string;
  replyTo: string | null;
  status: string;
  verifyToken: string;
  verifiedAt: Date | null;
  lastError: string | null;
  /** The exact TXT record to publish — computed, never stored twice. */
  recordName: string;
}

function senderView(row: {
  id: number; fromEmail: string; fromName: string; replyTo: string | null;
  status: string; verifyToken: string; verifiedAt: Date | null; lastError: string | null;
}): SenderView {
  const domain = emailDomain(row.fromEmail) ?? row.fromEmail;
  return { ...row, recordName: `_builderforce-sender.${domain}` };
}

const SENDER_COLUMNS = {
  id: marketingSenderIdentities.id,
  fromEmail: marketingSenderIdentities.fromEmail,
  fromName: marketingSenderIdentities.fromName,
  replyTo: marketingSenderIdentities.replyTo,
  status: marketingSenderIdentities.status,
  verifyToken: marketingSenderIdentities.verifyToken,
  verifiedAt: marketingSenderIdentities.verifiedAt,
  lastError: marketingSenderIdentities.lastError,
} as const;

export async function listSenders(db: Db, tenantId: number): Promise<SenderView[]> {
  const rows = await db
    .select(SENDER_COLUMNS)
    .from(marketingSenderIdentities)
    .where(eq(marketingSenderIdentities.tenantId, tenantId))
    .orderBy(asc(marketingSenderIdentities.id));
  return rows.map(senderView);
}

export type SenderResult =
  | { ok: true; sender: SenderView }
  | { ok: false; status: 400 | 404; error: string };

export async function createSender(
  db: Db,
  tenantId: number,
  input: { fromEmail: string; fromName?: string; replyTo?: string },
): Promise<SenderResult> {
  if (!isSendableEmail(input.fromEmail)) {
    return { ok: false, status: 400, error: 'Enter a valid From address.' };
  }
  const fromEmail = normalizeEmail(input.fromEmail);
  const [row] = await db
    .insert(marketingSenderIdentities)
    .values({
      tenantId,
      fromEmail,
      fromName: (input.fromName ?? '').slice(0, 255),
      replyTo: input.replyTo && isSendableEmail(input.replyTo) ? normalizeEmail(input.replyTo) : null,
      verifyToken: newChallengeToken(),
      status: 'pending',
    })
    .onConflictDoUpdate({
      target: [marketingSenderIdentities.tenantId, marketingSenderIdentities.fromEmail],
      set: { fromName: sql`excluded.from_name`, replyTo: sql`excluded.reply_to`, updatedAt: sql`NOW()` },
    })
    .returning(SENDER_COLUMNS);
  return { ok: true, sender: senderView(row!) };
}

/**
 * Resolve the sender's DNS proof and flip it to `verified` when it holds.
 * The proof lives on the address's DOMAIN, so verifying `hi@acme.com` also
 * establishes control of `sales@acme.com` — each address still gets its own row
 * and its own explicit verification, which is the auditable behaviour.
 */
export async function verifySender(
  db: Db,
  tenantId: number,
  senderId: number,
  deps: DnsLookupDeps = {},
): Promise<SenderResult> {
  const [row] = await db
    .select(SENDER_COLUMNS)
    .from(marketingSenderIdentities)
    .where(and(eq(marketingSenderIdentities.id, senderId), eq(marketingSenderIdentities.tenantId, tenantId)))
    .limit(1);
  if (!row) return { ok: false, status: 404, error: 'Sender not found.' };

  const domain = emailDomain(row.fromEmail);
  if (!domain) return { ok: false, status: 400, error: 'That From address has no resolvable domain.' };

  const proof = await verifyChallengeToken('sender', domain, row.verifyToken, deps);
  const [updated] = await db
    .update(marketingSenderIdentities)
    .set(
      proof.verified
        ? { status: 'verified', verifiedAt: sql`NOW()`, lastError: null, updatedAt: sql`NOW()` }
        : {
            status: 'pending',
            lastError: proof.found.length
              ? `Found TXT records at ${proof.recordName}, none matching the token.`
              : `No TXT record at ${proof.recordName} yet.`,
            updatedAt: sql`NOW()`,
          },
    )
    .where(and(eq(marketingSenderIdentities.id, senderId), eq(marketingSenderIdentities.tenantId, tenantId)))
    .returning(SENDER_COLUMNS);
  return { ok: true, sender: senderView(updated!) };
}

// ---------------------------------------------------------------------------
// Suppression
// ---------------------------------------------------------------------------

/** Add addresses to the tenant-wide do-not-contact list. Idempotent. */
export async function suppressEmails(
  db: Db,
  tenantId: number,
  emails: string[],
  reason: 'unsubscribed' | 'bounced' | 'complaint' | 'manual' = 'manual',
): Promise<number> {
  const rows = [...new Set(emails.filter(isSendableEmail).map(normalizeEmail))]
    .map((email) => ({ tenantId, email, reason }));
  if (rows.length === 0) return 0;
  const inserted = await db
    .insert(marketingSuppressions)
    .values(rows)
    .onConflictDoNothing()
    .returning({ id: marketingSuppressions.id });
  return inserted.length;
}

/** The subset of `emails` this tenant may not contact. ONE query, never per-row. */
export async function suppressedSubset(db: Db, tenantId: number, emails: string[]): Promise<Set<string>> {
  if (emails.length === 0) return new Set();
  const rows = await db
    .select({ email: marketingSuppressions.email })
    .from(marketingSuppressions)
    .where(and(eq(marketingSuppressions.tenantId, tenantId), inArray(marketingSuppressions.email, emails)));
  return new Set(rows.map((r) => r.email));
}

// ---------------------------------------------------------------------------
// Campaign rendering
// ---------------------------------------------------------------------------

export interface RenderContext {
  /** Absolute origin serving the tracking endpoints. */
  trackingOrigin: string;
  trackToken: string;
  /**
   * Absolute URL for `{{logo}}`. Resolved ONCE per campaign, not per recipient:
   * it is a tenant-level fact and a per-recipient lookup would add a query per
   * message to the hottest loop in the product.
   */
  logoUrl?: string | null;
}

/**
 * The origin baked into an email's tracking links — ONE resolver.
 *
 * It cannot be the request origin: a campaign that starts from an interactive
 * request and finishes on the cron sweep would otherwise stamp two different
 * hosts into the same campaign's links, and links already delivered must keep
 * working forever. Defaults to the same-origin gateway path (`builderforce.ai/
 * gateway`), which is the one host corporate networks reliably allow — an
 * unsubscribe link that a recipient's firewall blocks is a compliance problem,
 * not an inconvenience.
 */
export function resolveTrackingOrigin(env: { CAMPAIGN_TRACKING_ORIGIN?: string }): string {
  return (env.CAMPAIGN_TRACKING_ORIGIN ?? 'https://builderforce.ai/gateway').replace(/\/+$/, '');
}

/** The tracking URLs for one recipient. Kept together so the renderer and the
 *  route handlers cannot disagree about the path shape. */
export function trackingUrls(ctx: RenderContext) {
  const base = `${ctx.trackingOrigin.replace(/\/+$/, '')}/api/campaign-track`;
  return {
    open: `${base}/open/${ctx.trackToken}.gif`,
    click: `${base}/click/${ctx.trackToken}`,
    unsubscribe: `${base}/unsubscribe/${ctx.trackToken}`,
  };
}

/** Escape a string for safe interpolation into HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Render the message actually sent to one recipient.
 *
 * Four things happen here and nowhere else, so no campaign can ship without
 * them: outbound links are rewritten through the click tracker, an open pixel is
 * appended, an unsubscribe footer is added, and merge fields are substituted
 * with ESCAPED values — recipient attributes are attacker-controlled in the
 * ordinary case (anyone can type `<script>` into a signup form), so unescaped
 * interpolation here would be a stored XSS in the campaign preview.
 *
 * Pure — no I/O — so the link rewriting (the part with real injection risk) is
 * directly unit-testable.
 */
export function renderCampaignEmail(
  bodyHtml: string,
  ctx: RenderContext,
  recipient: { email: string; name?: string; attributes?: Record<string, unknown> },
): string {
  const urls = trackingUrls(ctx);

  let merged = String(bodyHtml ?? '')
    .replace(/\{\{\s*name\s*\}\}/g, escapeHtml(recipient.name || ''))
    .replace(/\{\{\s*email\s*\}\}/g, escapeHtml(recipient.email))
    .replace(/\{\{\s*logo\s*\}\}/g, escapeHtml(ctx.logoUrl ?? ''))
    .replace(/\{\{\s*unsubscribe\s*\}\}/g, urls.unsubscribe);

  // Audience attributes fill the template's own merge fields. An UNMATCHED field
  // resolves to empty rather than being left as `{{company}}` — mailing 4,000
  // people a literal placeholder is worse than mailing them a gap, and the
  // composer already warns the author which fields their audience is missing.
  merged = merged.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]{0,63})\s*\}\}/g, (_whole, field: string) => {
    const value = recipient.attributes?.[field];
    return value == null ? '' : escapeHtml(String(value));
  });

  // Rewrite only http(s) hrefs. mailto:, tel: and anchors are left alone, and
  // the tracker's own links are skipped so a second render cannot double-wrap.
  const tracked = merged.replace(
    /href\s*=\s*"(https?:\/\/[^"]+)"/gi,
    (whole, url: string) => {
      if (url.startsWith(urls.click) || url.startsWith(urls.unsubscribe)) return whole;
      return `href="${urls.click}?u=${encodeURIComponent(url)}"`;
    },
  );

  const footer =
    `<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;`
    + `font:12px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#6b7280">`
    + `<a href="${urls.unsubscribe}" style="color:#6b7280">Unsubscribe</a>`
    + `</div>`;
  const pixel = `<img src="${urls.open}" width="1" height="1" alt="" style="display:none">`;

  return `${tracked}${footer}${pixel}`;
}

// ---------------------------------------------------------------------------
// Campaign lifecycle
// ---------------------------------------------------------------------------

export interface CampaignView {
  id: number;
  name: string;
  subject: string;
  bodyHtml: string;
  status: string;
  audienceId: number;
  senderIdentityId: number | null;
  transport: string;
  mailboxConnectionId: number | null;
  connectorConnectionId: string | null;
  templateId: number | null;
  fromName: string;
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

const CAMPAIGN_COLUMNS = {
  id: marketingCampaigns.id,
  name: marketingCampaigns.name,
  subject: marketingCampaigns.subject,
  bodyHtml: marketingCampaigns.bodyHtml,
  status: marketingCampaigns.status,
  audienceId: marketingCampaigns.audienceId,
  senderIdentityId: marketingCampaigns.senderIdentityId,
  transport: marketingCampaigns.transport,
  mailboxConnectionId: marketingCampaigns.mailboxConnectionId,
  connectorConnectionId: marketingCampaigns.connectorConnectionId,
  templateId: marketingCampaigns.templateId,
  fromName: marketingCampaigns.fromName,
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
    name: string; audienceId: number; subject?: string; bodyHtml?: string;
    senderIdentityId?: number | null; projectId?: number | null; sessionId?: string | null;
    transport?: CampaignTransport; mailboxConnectionId?: number | null;
    connectorConnectionId?: string | null; templateId?: number | null; fromName?: string;
  },
): Promise<CampaignResult> {
  const [audience] = await db
    .select({ id: marketingAudiences.id })
    .from(marketingAudiences)
    .where(and(eq(marketingAudiences.id, input.audienceId), eq(marketingAudiences.tenantId, tenantId)))
    .limit(1);
  if (!audience) return { ok: false, status: 400, error: 'Pick an audience that belongs to this workspace.' };

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
      transport: input.transport ?? 'platform',
      mailboxConnectionId: input.mailboxConnectionId ?? null,
      connectorConnectionId: input.connectorConnectionId ?? null,
      templateId: input.templateId ?? null,
      fromName: (input.fromName ?? '').slice(0, 255),
      projectId: input.projectId ?? null,
      sessionId: input.sessionId ?? null,
      name: input.name.trim().slice(0, 255) || 'Campaign',
      subject,
      bodyHtml,
    })
    .returning(CAMPAIGN_COLUMNS);
  return { ok: true, campaign: row! };
}

export async function updateCampaign(
  db: Db,
  tenantId: number,
  campaignId: number,
  patch: {
    name?: string; subject?: string; bodyHtml?: string; senderIdentityId?: number | null;
    audienceId?: number; transport?: CampaignTransport; mailboxConnectionId?: number | null;
    connectorConnectionId?: string | null; templateId?: number | null; fromName?: string;
  },
): Promise<CampaignResult> {
  const set: Record<string, unknown> = { updatedAt: sql`NOW()` };
  if (typeof patch.name === 'string') set.name = patch.name.trim().slice(0, 255);
  if (typeof patch.subject === 'string') set.subject = patch.subject.slice(0, 500);
  if (typeof patch.bodyHtml === 'string') set.bodyHtml = patch.bodyHtml;
  if (patch.senderIdentityId !== undefined) set.senderIdentityId = patch.senderIdentityId;
  if (typeof patch.audienceId === 'number') set.audienceId = patch.audienceId;
  if (isCampaignTransport(patch.transport)) set.transport = patch.transport;
  if (patch.mailboxConnectionId !== undefined) set.mailboxConnectionId = patch.mailboxConnectionId;
  if (patch.connectorConnectionId !== undefined) set.connectorConnectionId = patch.connectorConnectionId;
  if (patch.templateId !== undefined) set.templateId = patch.templateId;
  if (typeof patch.fromName === 'string') set.fromName = patch.fromName.slice(0, 255);

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

export type StartResult =
  | { ok: true; campaign: CampaignView; queued: number; suppressed: number }
  | { ok: false; status: 400 | 404 | 409; error: string };

/**
 * Load a campaign's transport binding.
 *
 * ONE loader, used by both `startCampaign` (to refuse an unsendable campaign
 * before a single recipient row exists) and `runCampaignBatch` (to resolve the
 * sender for each batch). Two readers of the same binding is how "it let me
 * start and then failed every message" happens.
 */
async function loadTransportBinding(db: Db, tenantId: number, campaignId: number) {
  const [row] = await db
    .select({
      id: marketingCampaigns.id,
      status: marketingCampaigns.status,
      subject: marketingCampaigns.subject,
      bodyHtml: marketingCampaigns.bodyHtml,
      audienceId: marketingCampaigns.audienceId,
      transport: marketingCampaigns.transport,
      mailboxConnectionId: marketingCampaigns.mailboxConnectionId,
      connectorConnectionId: marketingCampaigns.connectorConnectionId,
      fromName: marketingCampaigns.fromName,
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
      senderIdentity: row.senderFromEmail
        ? { fromEmail: row.senderFromEmail, fromName: row.senderFromName ?? '', status: row.senderStatus ?? '' }
        : null,
      mailboxConnectionId: row.mailboxConnectionId,
      connectorConnectionId: row.connectorConnectionId,
      fromName: row.fromName,
    },
  };
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
  if (!campaign.subject.trim()) {
    return { ok: false, status: 400, error: 'Add a subject line before sending.' };
  }

  // Whichever transport this campaign uses, it must resolve NOW — the whole
  // point of the pre-flight is that a started campaign is safe to finish.
  const resolved = await resolveCampaignSender(db, env, tenantId, campaign.binding);
  if (!resolved.ok) return { ok: false, status: 400, error: resolved.error };

  const members = await db
    .select({ email: marketingAudienceMembers.email })
    .from(marketingAudienceMembers)
    .where(and(
      eq(marketingAudienceMembers.audienceId, campaign.audienceId),
      eq(marketingAudienceMembers.tenantId, tenantId),
      eq(marketingAudienceMembers.status, 'subscribed'),
    ));
  if (members.length === 0) {
    return { ok: false, status: 400, error: 'This audience has no subscribed members.' };
  }

  const emails = members.map((m) => m.email);
  const blocked = await suppressedSubset(db, tenantId, emails);
  const deliverable = emails.filter((e) => !blocked.has(e));
  if (deliverable.length === 0) {
    return { ok: false, status: 400, error: 'Every member of this audience has unsubscribed.' };
  }

  await db
    .insert(marketingCampaignSends)
    .values(deliverable.map((email) => ({
      campaignId,
      tenantId,
      email,
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

  return { ok: true, campaign: updated!, queued: deliverable.length, suppressed: blocked.size };
}

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
    const html = renderCampaignEmail(campaign.bodyHtml, ctx, {
      email: row.email,
      name: row.name ?? undefined,
      attributes: (row.attributes as Record<string, unknown> | null) ?? undefined,
    });
    try {
      await sender.send({
        to: row.email,
        subject: campaign.subject,
        html,
        unsubscribeUrl: trackingUrls(ctx).unsubscribe,
      });
      await db
        .update(marketingCampaignSends)
        .set({ status: 'sent', sentAt: sql`NOW()`, error: null })
        .where(and(eq(marketingCampaignSends.id, row.id), eq(marketingCampaignSends.tenantId, tenantId)));
      sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'send failed';
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
      reportCaughtError(error, { source: 'application/marketing/campaignEngine.ts', operation: 'runCampaignBatch' });
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
export async function recordOpen(db: Db, trackToken: string): Promise<void> {
  const updated = await db
    .update(marketingCampaignSends)
    .set({ openedAt: sql`NOW()` })
    .where(and(
      eq(marketingCampaignSends.trackToken, trackToken),
      sql`${marketingCampaignSends.openedAt} IS NULL`,
    ))
    .returning({ campaignId: marketingCampaignSends.campaignId, tenantId: marketingCampaignSends.tenantId });
  const hit = updated[0];
  if (!hit) return;
  await db
    .update(marketingCampaigns)
    .set({ opened: sql`${marketingCampaigns.opened} + 1`, updatedAt: sql`NOW()` })
    .where(and(eq(marketingCampaigns.id, hit.campaignId), eq(marketingCampaigns.tenantId, hit.tenantId)));
}

/** Record a click and return the destination to redirect to (validated). */
export async function recordClick(db: Db, trackToken: string, rawUrl: string): Promise<string | null> {
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
    .returning({ campaignId: marketingCampaignSends.campaignId, tenantId: marketingCampaignSends.tenantId });
  const hit = updated[0];
  if (hit) {
    await db
      .update(marketingCampaigns)
      .set({ clicked: sql`${marketingCampaigns.clicked} + 1`, updatedAt: sql`NOW()` })
      .where(and(eq(marketingCampaigns.id, hit.campaignId), eq(marketingCampaigns.tenantId, hit.tenantId)));
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

/** Campaigns still mid-send, for the cron sweep to advance. Bounded. */
export async function campaignsInFlight(db: Db, limit = 10): Promise<Array<{ id: number; tenantId: number }>> {
  return db
    .select({ id: marketingCampaigns.id, tenantId: marketingCampaigns.tenantId })
    .from(marketingCampaigns)
    .where(eq(marketingCampaigns.status, 'sending'))
    .orderBy(asc(marketingCampaigns.startedAt))
    .limit(limit);
}

/**
 * Advance every in-flight campaign by one batch.
 *
 * A send larger than one batch cannot complete inside the request that started
 * it — a Worker invocation is bounded — so this is what actually finishes a
 * campaign. Oldest-started first, so a large send cannot be starved by newer
 * ones, and the whole sweep is capped so one tenant cannot consume the tick.
 */
export async function runCampaignSendSweep(
  env: Env,
  db: Db,
  opts: { maxCampaigns?: number } = {},
): Promise<{ campaigns: number; sent: number; failed: number }> {
  const inFlight = await campaignsInFlight(db, opts.maxCampaigns ?? 5);
  const trackingOrigin = resolveTrackingOrigin(env);
  let sent = 0;
  let failed = 0;
  for (const campaign of inFlight) {
    const batch = await runCampaignBatch(env, db, campaign.tenantId, campaign.id, { trackingOrigin });
    sent += batch.sent;
    failed += batch.failed;
  }
  return { campaigns: inFlight.length, sent, failed };
}
