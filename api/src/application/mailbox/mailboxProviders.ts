/**
 * Mailbox provider adapters — Microsoft Graph and Gmail behind ONE interface.
 *
 * Everything above this file (the routes, the canvas inbox, the campaign send
 * engine, the MCP tools) speaks {@link MailboxProvider} and never knows which
 * vendor it is talking to. That is the whole point: "show me my inbox" and "send
 * this campaign from my mailbox" must not fork per provider, because the two
 * APIs disagree about almost everything —
 *
 *   • Gmail returns an opaque RFC-822 blob with headers in an array; Graph
 *     returns a typed JSON object with the headers already lifted out.
 *   • Gmail filters with a single `q` search string; Graph uses OData
 *     `$filter` + `$search`, which cannot be combined in one request.
 *   • Gmail sends a base64url-encoded MIME message you assemble yourself; Graph
 *     takes a JSON message object and assembles the MIME itself.
 *
 * Each adapter absorbs its vendor's shape and returns {@link MailboxMessage},
 * which is the ONLY message shape the rest of the codebase sees.
 *
 * Scopes are deliberately minimal and read-mostly: `gmail.readonly` +
 * `gmail.send` rather than `https://mail.google.com/` (which also grants
 * delete), and `Mail.Read` + `Mail.Send` rather than `Mail.ReadWrite`. A tenant
 * connecting a mailbox to run a campaign has not agreed to let us delete mail.
 */

import { reportCaughtError } from '../observability/caughtErrorReporter';

// ---------------------------------------------------------------------------
// The shared shape
// ---------------------------------------------------------------------------

export const MAILBOX_PROVIDER_NAMES = ['microsoft', 'google'] as const;
export type MailboxProviderName = typeof MAILBOX_PROVIDER_NAMES[number];

export function isMailboxProviderName(value: unknown): value is MailboxProviderName {
  return typeof value === 'string' && (MAILBOX_PROVIDER_NAMES as readonly string[]).includes(value);
}

/** One message, normalized. `bodyText` is a PREVIEW-grade plain-text rendering —
 *  enough for a model to triage or a canvas tile to show, never the raw MIME. */
export interface MailboxMessage {
  id: string;
  threadId: string | null;
  from: string;
  fromName: string;
  to: string[];
  subject: string;
  /** Provider-supplied one-line preview, or the first line of the body. */
  snippet: string;
  bodyText: string;
  receivedAtISO: string;
  unread: boolean;
  hasAttachments: boolean;
  /** Provider labels/folders, lowercased. Gmail label ids, Graph folder name. */
  labels: string[];
  /** Deep link into the provider's own web client, so a canvas tile can hand off. */
  webUrl: string | null;
}

/**
 * A provider-neutral inbox query.
 *
 * The fields are the intersection of what BOTH providers can express server-side.
 * Anything one provider cannot filter natively is applied client-side by the
 * adapter, so a caller's filter always means the same thing — a query that
 * silently did nothing on one provider would be worse than a slower one.
 */
export interface MailboxQuery {
  /** Free-text search across subject/body/participants. */
  search?: string;
  /** Match the sender address (substring, case-insensitive). */
  from?: string;
  /** Match the subject (substring, case-insensitive). */
  subject?: string;
  unreadOnly?: boolean;
  hasAttachments?: boolean;
  /** ISO instant; only messages received at or after this. */
  afterISO?: string;
  /** ISO instant; only messages received before this. */
  beforeISO?: string;
  limit?: number;
}

export interface OutgoingMessage {
  to: string;
  subject: string;
  html: string;
  /** Plain-text alternative. Spam filters penalise HTML-only mail, so the
   *  adapters always send multipart/alternative rather than HTML alone. */
  text?: string;
  /** Display name for the From:. The ADDRESS is always the connected account —
   *  a provider will not let you forge it, and we do not try. */
  fromName?: string;
  replyTo?: string;
  /** RFC 2369 one-click unsubscribe. Set for campaign sends; a bulk message
   *  without it gets filed as spam by Gmail and Outlook alike. */
  listUnsubscribeUrl?: string;
}

export interface MailboxProvider {
  name: MailboxProviderName;
  label: string;
  authUrl: string;
  tokenUrl: string;
  scopes: readonly string[];
  /** Env keys holding the OAuth app credentials — read late so an unconfigured
   *  provider reports "not configured" instead of throwing at import time. */
  clientIdKey: 'GOOGLE_CLIENT_ID' | 'MICROSOFT_CLIENT_ID';
  clientSecretKey: 'GOOGLE_CLIENT_SECRET' | 'MICROSOFT_CLIENT_SECRET';
  /** Provider-specific params appended to the consent URL. */
  extraAuthParams?: Record<string, string>;
  /** Resolve the address of the mailbox that was just granted. */
  accountInfo(accessToken: string): Promise<{ email: string; displayName: string }>;
  listMessages(accessToken: string, query: MailboxQuery): Promise<MailboxMessage[]>;
  getMessage(accessToken: string, messageId: string): Promise<MailboxMessage | null>;
  sendMessage(accessToken: string, message: OutgoingMessage): Promise<{ id: string }>;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Clamp a caller-supplied page size. Both providers cap far higher, but an
 *  inbox tile and a model's context window do not want 500 messages. */
export const MAILBOX_MAX_LIMIT = 100;
export const MAILBOX_DEFAULT_LIMIT = 25;
export function clampMailboxLimit(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return MAILBOX_DEFAULT_LIMIT;
  return Math.max(1, Math.min(Math.trunc(n), MAILBOX_MAX_LIMIT));
}

function toIso(value: unknown): string {
  const d = new Date(String(value ?? ''));
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
}

/** Split `Ada Lovelace <ada@example.com>` into its parts. Tolerates a bare address. */
function parseAddress(raw: string): { email: string; name: string } {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(raw ?? '');
  if (match) return { name: match[1]!.replace(/^"|"$/g, ''), email: match[2]!.trim().toLowerCase() };
  return { name: '', email: (raw ?? '').trim().toLowerCase() };
}

/**
 * Strip markup to a readable plain-text preview.
 *
 * Not a sanitizer and not reversible — the output is for a model to read and a
 * tile to show. `<style>`/`<script>` bodies are dropped wholesale first, because
 * a marketing email is mostly CSS and leaving it in would drown the actual words.
 */
export function htmlToPreviewText(html: string): string {
  return String(html ?? '')
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    // Collapse whitespace AROUND the newlines before collapsing the newlines
    // themselves. Stripping a tag leaves a space where it stood, so `</p><p>`
    // becomes "\n " and every line of the preview would start with a space.
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Base64url (RFC 4648 §5, unpadded) over UTF-8 — Gmail's `raw` encoding. */
function base64Url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decode Gmail's base64url message parts back to UTF-8. */
function decodeBase64Url(input: string): string {
  try {
    const padded = input.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return '';
  }
}

/**
 * Encode a header value that may contain non-ASCII (RFC 2047 encoded-word).
 *
 * A display name like "Ada Løvelace" written raw into a header produces mojibake
 * in most clients and is rejected outright by some MTAs, so it must be encoded
 * even though the body is already UTF-8.
 */
function encodeHeaderValue(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  return `=?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(value)))}?=`;
}

/**
 * Build a multipart/alternative MIME message.
 *
 * Shared by the Gmail adapter (which needs raw MIME) and unused by Graph (which
 * assembles its own) — but it lives here rather than inside the Gmail adapter
 * because the header set is a deliverability decision, not a vendor detail: the
 * `List-Unsubscribe` pair below is what keeps a bulk send out of the spam folder.
 */
export function buildMimeMessage(
  from: { email: string; name?: string },
  message: OutgoingMessage,
): string {
  const boundary = `bf_${crypto.randomUUID().replace(/-/g, '')}`;
  const fromHeader = message.fromName || from.name
    ? `${encodeHeaderValue(message.fromName || from.name || '')} <${from.email}>`
    : from.email;
  const headers = [
    `From: ${fromHeader}`,
    `To: ${message.to}`,
    `Subject: ${encodeHeaderValue(message.subject ?? '')}`,
    message.replyTo ? `Reply-To: ${message.replyTo}` : '',
    // Both headers, together: List-Unsubscribe alone still shows a confirmation
    // step, and List-Unsubscribe-Post is what makes it genuinely one-click.
    message.listUnsubscribeUrl ? `List-Unsubscribe: <${message.listUnsubscribeUrl}>` : '',
    message.listUnsubscribeUrl ? 'List-Unsubscribe-Post: List-Unsubscribe=One-Click' : '',
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ].filter(Boolean).join('\r\n');

  const text = message.text?.trim() || htmlToPreviewText(message.html);
  return [
    headers,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    text,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    message.html ?? '',
    '',
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

/**
 * Apply the parts of a query the provider could not express server-side.
 *
 * Both adapters call this on their way out, so a filter means the same thing on
 * either provider even where only one of them can push it down to the API.
 */
export function applyClientSideFilters(messages: MailboxMessage[], query: MailboxQuery): MailboxMessage[] {
  const from = query.from?.trim().toLowerCase();
  const subject = query.subject?.trim().toLowerCase();
  const after = query.afterISO ? Date.parse(query.afterISO) : NaN;
  const before = query.beforeISO ? Date.parse(query.beforeISO) : NaN;

  return messages.filter((m) => {
    if (from && !`${m.from} ${m.fromName}`.toLowerCase().includes(from)) return false;
    if (subject && !m.subject.toLowerCase().includes(subject)) return false;
    if (query.unreadOnly && !m.unread) return false;
    if (query.hasAttachments && !m.hasAttachments) return false;
    if (!Number.isNaN(after) && Date.parse(m.receivedAtISO) < after) return false;
    if (!Number.isNaN(before) && Date.parse(m.receivedAtISO) >= before) return false;
    return true;
  });
}

/** Throw a readable error from a failed provider call rather than a bare status. */
async function providerError(label: string, res: Response): Promise<never> {
  const body = await res.text().catch(() => '');
  let detail = body.slice(0, 300);
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string; error_description?: string };
    detail = (typeof parsed.error === 'object' ? parsed.error?.message : parsed.error)
      ?? parsed.error_description ?? detail;
  } catch { /* non-JSON body — the truncated text is the best detail available */ }
  throw new MailboxProviderError(`${label} failed (${res.status}): ${detail}`, res.status);
}

/** Distinguishes "the provider said no" from a bug on our side. `status` 401/403
 *  is what the service layer reads to decide a grant is revoked vs. transient. */
export class MailboxProviderError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'MailboxProviderError';
  }
}

// ---------------------------------------------------------------------------
// Google — Gmail API v1
// ---------------------------------------------------------------------------

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

/**
 * Translate a {@link MailboxQuery} into a Gmail `q` string.
 *
 * Gmail's search is the richer of the two, so nearly everything pushes down. The
 * date operators are day-granular (`after:2026/08/01`), which is why the caller's
 * exact instant is STILL re-applied client-side — pushing down narrows the fetch,
 * it does not replace the filter.
 */
function gmailQuery(query: MailboxQuery): string {
  const parts: string[] = [];
  if (query.search?.trim()) parts.push(query.search.trim());
  if (query.from?.trim()) parts.push(`from:${query.from.trim()}`);
  if (query.subject?.trim()) parts.push(`subject:${JSON.stringify(query.subject.trim())}`);
  if (query.unreadOnly) parts.push('is:unread');
  if (query.hasAttachments) parts.push('has:attachment');
  const day = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? ''
      : `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  };
  if (query.afterISO) { const d = day(query.afterISO); if (d) parts.push(`after:${d}`); }
  if (query.beforeISO) { const d = day(query.beforeISO); if (d) parts.push(`before:${d}`); }
  return parts.join(' ');
}

interface GmailPart {
  mimeType?: string;
  body?: { data?: string; size?: number; attachmentId?: string };
  filename?: string;
  parts?: GmailPart[];
  headers?: Array<{ name?: string; value?: string }>;
}

/** Depth-first search for the best body part: prefer text/plain, fall back to
 *  text/html rendered down to text. A real message nests these several levels
 *  deep inside multipart/related inside multipart/alternative. */
function gmailBody(part: GmailPart | undefined): { text: string; hasAttachments: boolean } {
  let plain = '';
  let html = '';
  let hasAttachments = false;

  const walk = (p: GmailPart | undefined): void => {
    if (!p) return;
    if (p.filename && p.body?.attachmentId) hasAttachments = true;
    const data = p.body?.data;
    if (data) {
      if (p.mimeType === 'text/plain' && !plain) plain = decodeBase64Url(data);
      else if (p.mimeType === 'text/html' && !html) html = decodeBase64Url(data);
    }
    for (const child of p.parts ?? []) walk(child);
  };
  walk(part);

  return { text: plain.trim() || htmlToPreviewText(html), hasAttachments };
}

function gmailToMessage(raw: Record<string, unknown>): MailboxMessage {
  const payload = raw.payload as GmailPart | undefined;
  const headers = new Map(
    (payload?.headers ?? []).map((h) => [String(h.name ?? '').toLowerCase(), String(h.value ?? '')]),
  );
  const sender = parseAddress(headers.get('from') ?? '');
  const { text, hasAttachments } = gmailBody(payload);
  const labels = ((raw.labelIds as string[] | undefined) ?? []).map((l) => l.toLowerCase());
  const id = String(raw.id ?? '');
  const internalDate = raw.internalDate ? Number(raw.internalDate) : NaN;

  return {
    id,
    threadId: raw.threadId ? String(raw.threadId) : null,
    from: sender.email,
    fromName: sender.name,
    to: (headers.get('to') ?? '').split(',').map((a) => parseAddress(a).email).filter(Boolean),
    subject: headers.get('subject') ?? '(no subject)',
    snippet: String(raw.snippet ?? '').trim(),
    bodyText: text,
    receivedAtISO: Number.isFinite(internalDate)
      ? new Date(internalDate).toISOString()
      : toIso(headers.get('date')),
    unread: labels.includes('unread'),
    hasAttachments,
    labels,
    webUrl: id ? `https://mail.google.com/mail/u/0/#inbox/${id}` : null,
  };
}

const googleMailbox: MailboxProvider = {
  name: 'google',
  label: 'Gmail',
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  // Read + send only. `gmail.readonly` deliberately over `https://mail.google.com/`,
  // which would also grant delete.
  scopes: [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/userinfo.email',
  ],
  clientIdKey: 'GOOGLE_CLIENT_ID',
  clientSecretKey: 'GOOGLE_CLIENT_SECRET',
  // `access_type=offline` + `prompt=consent` is the only way Google reliably
  // returns a refresh token — without it a re-consent yields an access token that
  // expires in an hour and a campaign mid-send dies with no way to recover.
  extraAuthParams: { access_type: 'offline', prompt: 'consent' },

  async accountInfo(accessToken) {
    const res = await fetch(`${GMAIL_BASE}/profile`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return providerError('Gmail profile', res);
    const body = await res.json() as { emailAddress?: string };
    return { email: String(body.emailAddress ?? '').toLowerCase(), displayName: '' };
  },

  async listMessages(accessToken, query) {
    const limit = clampMailboxLimit(query.limit);
    const params = new URLSearchParams({ maxResults: String(limit) });
    const q = gmailQuery(query);
    if (q) params.set('q', q);

    const listRes = await fetch(`${GMAIL_BASE}/messages?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!listRes.ok) return providerError('Gmail list', listRes);
    const list = await listRes.json() as { messages?: Array<{ id?: string }> };
    const ids = (list.messages ?? []).map((m) => String(m.id ?? '')).filter(Boolean);
    if (ids.length === 0) return [];

    // Gmail's list endpoint returns ids only, so each message needs its own GET.
    // Concurrent rather than sequential: `limit` is capped at 100 and a serial
    // loop would blow the Worker's wall-clock budget on a full page.
    const settled = await Promise.allSettled(ids.map(async (id) => {
      const res = await fetch(`${GMAIL_BASE}/messages/${encodeURIComponent(id)}?format=full`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return providerError('Gmail get', res);
      return gmailToMessage(await res.json() as Record<string, unknown>);
    }));

    const messages: MailboxMessage[] = [];
    for (const result of settled) {
      if (result.status === 'fulfilled') messages.push(result.value);
      else {
        reportCaughtError(result.reason, {
          source: 'application/mailbox/mailboxProviders.ts', operation: 'googleMailbox.listMessages',
        });
      }
    }
    messages.sort((a, b) => b.receivedAtISO.localeCompare(a.receivedAtISO));
    return applyClientSideFilters(messages, query);
  },

  async getMessage(accessToken, messageId) {
    const res = await fetch(`${GMAIL_BASE}/messages/${encodeURIComponent(messageId)}?format=full`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 404) return null;
    if (!res.ok) return providerError('Gmail get', res);
    return gmailToMessage(await res.json() as Record<string, unknown>);
  },

  async sendMessage(accessToken, message) {
    const { email } = await this.accountInfo(accessToken);
    const raw = base64Url(buildMimeMessage({ email }, message));
    const res = await fetch(`${GMAIL_BASE}/messages/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    });
    if (!res.ok) return providerError('Gmail send', res);
    const body = await res.json() as { id?: string };
    return { id: String(body.id ?? '') };
  },
};

// ---------------------------------------------------------------------------
// Microsoft — Graph v1.0
// ---------------------------------------------------------------------------

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0/me';

/**
 * Graph `$filter` — the OData subset that is actually indexed on messages.
 *
 * `$search` and `$filter` are MUTUALLY EXCLUSIVE on Graph's message collection
 * (a request carrying both is rejected), which is why the caller's free-text
 * `search` takes over the request entirely when present and everything else
 * falls back to a client-side pass.
 */
function graphFilter(query: MailboxQuery): string {
  const clauses: string[] = [];
  const esc = (v: string) => v.replace(/'/g, "''");
  if (query.unreadOnly) clauses.push('isRead eq false');
  if (query.hasAttachments) clauses.push('hasAttachments eq true');
  if (query.from?.trim()) {
    clauses.push(`contains(from/emailAddress/address,'${esc(query.from.trim().toLowerCase())}')`);
  }
  if (query.subject?.trim()) clauses.push(`contains(subject,'${esc(query.subject.trim())}')`);
  if (query.afterISO && !Number.isNaN(Date.parse(query.afterISO))) {
    clauses.push(`receivedDateTime ge ${new Date(query.afterISO).toISOString()}`);
  }
  if (query.beforeISO && !Number.isNaN(Date.parse(query.beforeISO))) {
    clauses.push(`receivedDateTime lt ${new Date(query.beforeISO).toISOString()}`);
  }
  return clauses.join(' and ');
}

interface GraphMessage {
  id?: string;
  conversationId?: string;
  subject?: string;
  bodyPreview?: string;
  receivedDateTime?: string;
  isRead?: boolean;
  hasAttachments?: boolean;
  webLink?: string;
  parentFolderId?: string;
  from?: { emailAddress?: { address?: string; name?: string } };
  toRecipients?: Array<{ emailAddress?: { address?: string } }>;
  body?: { contentType?: string; content?: string };
}

function graphToMessage(raw: GraphMessage): MailboxMessage {
  const body = raw.body?.content ?? '';
  const text = raw.body?.contentType?.toLowerCase() === 'html' ? htmlToPreviewText(body) : body.trim();
  return {
    id: String(raw.id ?? ''),
    threadId: raw.conversationId ? String(raw.conversationId) : null,
    from: String(raw.from?.emailAddress?.address ?? '').toLowerCase(),
    fromName: String(raw.from?.emailAddress?.name ?? ''),
    to: (raw.toRecipients ?? [])
      .map((r) => String(r.emailAddress?.address ?? '').toLowerCase())
      .filter(Boolean),
    subject: raw.subject?.trim() || '(no subject)',
    snippet: String(raw.bodyPreview ?? '').trim(),
    bodyText: text,
    receivedAtISO: toIso(raw.receivedDateTime),
    unread: raw.isRead === false,
    hasAttachments: raw.hasAttachments === true,
    labels: raw.parentFolderId ? [String(raw.parentFolderId).toLowerCase()] : [],
    webUrl: raw.webLink ?? null,
  };
}

const GRAPH_SELECT = [
  'id', 'conversationId', 'subject', 'bodyPreview', 'receivedDateTime', 'isRead',
  'hasAttachments', 'webLink', 'parentFolderId', 'from', 'toRecipients', 'body',
].join(',');

const microsoftMailbox: MailboxProvider = {
  name: 'microsoft',
  label: 'Microsoft 365',
  // `common` rather than a tenant id: a Builderforce customer's Microsoft tenant
  // is not ours, and pinning our own would make every external mailbox unconnectable.
  authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
  tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
  // Mail.Read (not ReadWrite) + Mail.Send. `offline_access` is what yields the
  // refresh token; without it Graph returns a 1-hour token and nothing else.
  scopes: ['offline_access', 'openid', 'email', 'profile', 'Mail.Read', 'Mail.Send', 'User.Read'],
  clientIdKey: 'MICROSOFT_CLIENT_ID',
  clientSecretKey: 'MICROSOFT_CLIENT_SECRET',
  extraAuthParams: { response_mode: 'query', prompt: 'select_account' },

  async accountInfo(accessToken) {
    const res = await fetch(`${GRAPH_BASE}?$select=mail,userPrincipalName,displayName`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return providerError('Graph profile', res);
    const body = await res.json() as { mail?: string; userPrincipalName?: string; displayName?: string };
    // `mail` is null for accounts without an Exchange licence; the UPN is the
    // address they actually sign in with and is the correct fallback.
    return {
      email: String(body.mail ?? body.userPrincipalName ?? '').toLowerCase(),
      displayName: String(body.displayName ?? ''),
    };
  },

  async listMessages(accessToken, query) {
    const limit = clampMailboxLimit(query.limit);
    const params = new URLSearchParams({ $top: String(limit), $select: GRAPH_SELECT });
    const search = query.search?.trim();
    if (search) {
      // $search cannot be combined with $filter or $orderby — the remaining
      // predicates fall through to applyClientSideFilters below.
      params.set('$search', `"${search.replace(/"/g, '')}"`);
    } else {
      const filter = graphFilter(query);
      if (filter) params.set('$filter', filter);
      params.set('$orderby', 'receivedDateTime desc');
    }

    const res = await fetch(`${GRAPH_BASE}/messages?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}`, ConsistencyLevel: 'eventual' },
    });
    if (!res.ok) return providerError('Graph list', res);
    const body = await res.json() as { value?: GraphMessage[] };
    const messages = (body.value ?? []).map(graphToMessage);
    messages.sort((a, b) => b.receivedAtISO.localeCompare(a.receivedAtISO));
    return applyClientSideFilters(messages, query);
  },

  async getMessage(accessToken, messageId) {
    const res = await fetch(
      `${GRAPH_BASE}/messages/${encodeURIComponent(messageId)}?$select=${GRAPH_SELECT}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (res.status === 404) return null;
    if (!res.ok) return providerError('Graph get', res);
    return graphToMessage(await res.json() as GraphMessage);
  },

  async sendMessage(accessToken, message) {
    // Graph assembles the MIME itself, so the unsubscribe headers have to be
    // handed over as internetMessageHeaders. Graph rejects any header outside the
    // `x-` namespace EXCEPT a known allow-list, and List-Unsubscribe is on it.
    const headers = message.listUnsubscribeUrl
      ? [
          { name: 'List-Unsubscribe', value: `<${message.listUnsubscribeUrl}>` },
          { name: 'List-Unsubscribe-Post', value: 'List-Unsubscribe=One-Click' },
        ]
      : undefined;

    const res = await fetch(`${GRAPH_BASE}/sendMail`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          subject: message.subject ?? '',
          body: { contentType: 'HTML', content: message.html ?? '' },
          toRecipients: [{ emailAddress: { address: message.to } }],
          ...(message.replyTo ? { replyTo: [{ emailAddress: { address: message.replyTo } }] } : {}),
          ...(headers ? { internetMessageHeaders: headers } : {}),
        },
        // The whole point of a campaign send is a record of what went out; the
        // provider's own Sent Items is the cheapest and most trustworthy copy.
        saveToSentItems: true,
      }),
    });
    if (!res.ok) return providerError('Graph send', res);
    // sendMail returns 202 Accepted with an empty body — there is no message id
    // to return, so the accepted status IS the receipt.
    return { id: '' };
  },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const PROVIDERS: Record<MailboxProviderName, MailboxProvider> = {
  google: googleMailbox,
  microsoft: microsoftMailbox,
};

export function getMailboxProvider(name: string): MailboxProvider | null {
  return isMailboxProviderName(name) ? PROVIDERS[name] : null;
}

/**
 * The providers this deployment can actually offer.
 *
 * Reported rather than assumed: a self-hosted install with only
 * `GOOGLE_CLIENT_ID` bound must show Gmail and hide Microsoft, not offer both
 * and fail at the redirect.
 */
export function availableMailboxProviders(
  env: Record<string, unknown>,
): Array<{ name: MailboxProviderName; label: string; configured: boolean }> {
  return MAILBOX_PROVIDER_NAMES.map((name) => {
    const provider = PROVIDERS[name];
    return {
      name,
      label: provider.label,
      configured: isProviderOAuthConfigured(env, provider),
    };
  });
}
