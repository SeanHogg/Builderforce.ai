/**
 * `investorUpdate.send`, with a delivery behind it.
 *
 * ── WHAT THIS CLOSES ─────────────────────────────────────────────────────────
 * `investorUpdate.send` was named by `canvasApprovalGate.GATED_ACTIONS` as an
 * outbound act needing a named approver, advertised by `founderObjects.ts`, and
 * had no handler — so the gate correctly refused to let a model send it, and a
 * human clicking it got the "no delivery adapter" notice. The monthly update sat
 * on the same board as the metrics it quotes and left through somebody's mail
 * client, retyped.
 *
 * ── WHY THIS IS WIRING AND NOT A SECOND SENDER ───────────────────────────────
 * `campaignTransports.ts` already resolves a tenant's binding into something that
 * can send — platform, their own connected mailbox, or their SendGrid connection
 * — and already draws the distinction that matters at volume: `retryable` says
 * whether a failure is this recipient's or everyone's. An investor update is that
 * with a different audience. Building a second sender would mean a second answer
 * to "did it go out", and the first thing to diverge would be the failure
 * handling, which is the part that took the mailbox work three attempts to get
 * right.
 *
 * So this module composes: it renders the update, resolves the SAME sender, and
 * records ONE delivery row per recipient in the kernel's `deliveries` — the store
 * that already absorbs sixteen outbound tables and already carries `retryable` as
 * a column rather than an inference.
 */

import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { deliveries } from '../../infrastructure/database/schema';
import {
  resolveCampaignSender,
  TransportError,
  type TransportBinding,
} from '../marketing/campaignTransports';

export class InvestorUpdateError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'InvestorUpdateError';
  }
}

/** An update goes to a board, not a mailing list. Beyond this it is a campaign
 *  and belongs in the campaign engine, which has batching and suppression. */
const MAX_RECIPIENTS = 200;

/** The canvas object's authored shape, as the card holds it. */
export interface InvestorUpdateContent {
  title: string;
  period?: string | null;
  highlights?: ReadonlyArray<{ title?: string; detail?: string }>;
  lowlights?: ReadonlyArray<{ title?: string; detail?: string }>;
  metrics?: ReadonlyArray<{ metric?: string; value?: string; previous?: string; change?: string }>;
  asks?: readonly string[];
  summary?: string | null;
}

export interface InvestorUpdateRecipient {
  email: string;
  name?: string | null;
  /** `party_roles.party_ref` where the investor is a known counterparty. */
  partyRef?: string | null;
}

export interface SendInvestorUpdateResult {
  sent: number;
  failed: Array<{ email: string; error: string; retryable: boolean }>;
  transport: string;
  fromLabel: string;
}

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

const section = (heading: string, rows: readonly string[]): string =>
  rows.length ? `<h3 style="margin:24px 0 8px;font:600 15px/1.4 system-ui,sans-serif">${escapeHtml(heading)}</h3><ul style="margin:0;padding-left:20px;font:400 14px/1.6 system-ui,sans-serif">${rows.map((r) => `<li>${r}</li>`).join('')}</ul>` : '';

/**
 * Render the update to HTML.
 *
 * Inline styles and a table, deliberately: an investor update is read in Gmail,
 * Outlook and a phone, none of which honour a stylesheet. Escaped at every
 * insertion point because the content is authored on a canvas that a model also
 * writes to — an update is not a place to discover that a metric name can carry
 * markup.
 *
 * LOWLIGHTS ARE NOT OPTIONAL in the layout: the object's own hint says an update
 * with no lowlights "is not read as good news, it is read as unreliable", and a
 * renderer that silently drops the empty section would make omitting them
 * invisible. When there are none it says so.
 */
export function renderInvestorUpdate(content: InvestorUpdateContent): { subject: string; html: string } {
  const period = content.period?.trim();
  const subject = period ? `${content.title} — ${period}` : content.title;

  const bullets = (rows: InvestorUpdateContent['highlights']): string[] =>
    (rows ?? []).flatMap((row) => {
      const title = row.title?.trim();
      const detail = row.detail?.trim();
      if (!title && !detail) return [];
      return [`${title ? `<strong>${escapeHtml(title)}</strong>` : ''}${title && detail ? ' — ' : ''}${detail ? escapeHtml(detail) : ''}`];
    });

  const metricRows = (content.metrics ?? []).flatMap((row) => {
    const metric = row.metric?.trim();
    if (!metric) return [];
    return [`<tr><td style="padding:6px 12px 6px 0">${escapeHtml(metric)}</td><td style="padding:6px 12px 6px 0;font-weight:600">${escapeHtml(row.value?.trim() ?? '—')}</td><td style="padding:6px 12px 6px 0;color:#666">${escapeHtml(row.previous?.trim() ?? '—')}</td><td style="padding:6px 0">${escapeHtml(row.change?.trim() ?? '—')}</td></tr>`];
  });

  const lows = bullets(content.lowlights);

  const html = [
    `<div style="max-width:640px;margin:0 auto;padding:24px;color:#111">`,
    `<h2 style="margin:0 0 4px;font:600 20px/1.3 system-ui,sans-serif">${escapeHtml(content.title)}</h2>`,
    period ? `<p style="margin:0 0 16px;color:#666;font:400 14px/1.4 system-ui,sans-serif">${escapeHtml(period)}</p>` : '',
    content.summary?.trim() ? `<p style="font:400 15px/1.6 system-ui,sans-serif">${escapeHtml(content.summary.trim())}</p>` : '',
    metricRows.length
      ? `<h3 style="margin:24px 0 8px;font:600 15px/1.4 system-ui,sans-serif">Metrics</h3><table style="border-collapse:collapse;font:400 14px/1.5 system-ui,sans-serif"><thead><tr style="text-align:left;color:#666"><th style="padding:0 12px 6px 0">Metric</th><th style="padding:0 12px 6px 0">Now</th><th style="padding:0 12px 6px 0">Previous</th><th style="padding:0 0 6px">Change</th></tr></thead><tbody>${metricRows.join('')}</tbody></table>`
      : '',
    section('Highlights', bullets(content.highlights)),
    // Stated rather than omitted — see the note above.
    lows.length
      ? section('Lowlights', lows)
      : `<h3 style="margin:24px 0 8px;font:600 15px/1.4 system-ui,sans-serif">Lowlights</h3><p style="margin:0;font:400 14px/1.6 system-ui,sans-serif;color:#666">None recorded this period.</p>`,
    section('Asks', (content.asks ?? []).filter(Boolean).map((ask) => escapeHtml(ask))),
    `</div>`,
  ].join('');

  return { subject, html };
}

/**
 * Send one update to its investors.
 *
 * Sequential, and bounded at {@link MAX_RECIPIENTS}. An investor list is tens of
 * addresses, so the parallelism a campaign needs would buy nothing and would make
 * the per-recipient failure record harder to attribute — which is the thing
 * anybody actually wants afterwards.
 *
 * A NON-RETRYABLE failure stops the send. That is the transport contract's own
 * distinction applied honestly: a revoked mailbox grant or a bad key fails
 * identically for everyone left, so continuing would burn the rest of the list
 * into `failed` rows for no reason. A retryable one fails just that recipient.
 */
export async function sendInvestorUpdate(
  db: Db,
  env: Env,
  tenantId: number,
  input: {
    content: InvestorUpdateContent;
    recipients: readonly InvestorUpdateRecipient[];
    binding: TransportBinding;
    /** The canvas object, so the delivery ledger points back at what was sent. */
    objectId?: string | null;
  },
): Promise<SendInvestorUpdateResult> {
  const recipients = input.recipients
    .map((r) => ({ ...r, email: r.email.trim().toLowerCase() }))
    .filter((r) => r.email.includes('@'));
  if (!recipients.length) {
    throw new InvestorUpdateError('This update has no investors to send to. Add them to the funding round\'s investor list first.', 400);
  }
  if (recipients.length > MAX_RECIPIENTS) {
    throw new InvestorUpdateError(`An investor update goes to at most ${MAX_RECIPIENTS} recipients. A larger list is a campaign — use the campaign engine, which batches and honours suppression.`, 400);
  }
  if (!input.content.title.trim()) throw new InvestorUpdateError('The update needs a title.', 400);

  const resolved = await resolveCampaignSender(db, env, tenantId, input.binding);
  if (!resolved.ok) throw new InvestorUpdateError(resolved.error, 400);

  const { subject, html } = renderInvestorUpdate(input.content);
  const failed: SendInvestorUpdateResult['failed'] = [];
  let sent = 0;

  for (const recipient of recipients) {
    try {
      await resolved.sender.send({ to: recipient.email, subject, html });
      sent += 1;
      await recordDelivery(db, tenantId, input.objectId ?? null, recipient.email, subject, 'sent', null);
    } catch (error) {
      const retryable = error instanceof TransportError ? error.retryable : true;
      const message = error instanceof Error ? error.message : 'Send failed';
      failed.push({ email: recipient.email, error: message, retryable });
      await recordDelivery(db, tenantId, input.objectId ?? null, recipient.email, subject, 'failed', { error: message, retryable });
      // See the note: a hopeless failure stops the run rather than repeating
      // itself once per remaining investor.
      if (!retryable) break;
    }
  }

  return { sent, failed, transport: resolved.sender.transport, fromLabel: resolved.sender.fromLabel };
}

/**
 * One row per recipient in the kernel's outbound store — the same table every
 * other send lands in, so "what left the building" is one query.
 *
 * `retryable` is written from the transport's own verdict rather than left at its
 * default, which is the whole reason that column is a column: deriving it from
 * the error string at retry time is how a hard bounce gets retried for a week.
 */
async function recordDelivery(
  db: Db,
  tenantId: number,
  objectId: string | null,
  recipient: string,
  subject: string,
  status: 'sent' | 'failed',
  failure: { error: string; retryable: boolean } | null,
): Promise<void> {
  await db.insert(deliveries).values({
    tenantId,
    objectId,
    channel: 'email',
    recipient,
    template: 'investor_update',
    subject,
    status,
    attempts: 1,
    retryable: failure ? failure.retryable : false,
    ...(status === 'sent' ? { sentAt: new Date() } : {}),
    ...(failure ? { error: failure.error } : {}),
  });
}
