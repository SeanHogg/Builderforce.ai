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
import { isProviderOAuthConfigured } from '../shared/providerOAuthConnect';

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

/**
 * One attachment, normalized. METADATA ONLY — the bytes are a separate call.
 *
 * Deliberately separate because the two have opposite costs and opposite
 * audiences: a listing is cheap, safe to show in a tile and safe to hand a model,
 * whereas the bytes are megabytes that must never enter a transcript and are only
 * ever wanted for exactly one file a person picked.
 */
export interface MailboxAttachment {
  /** The provider's handle for this attachment ON THIS MESSAGE. Gmail's
   *  `attachmentId` is not stable across messages and Graph's id is scoped to
   *  one message too, which is why every read takes both ids. */
  id: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  /**
   * True when the body references this by `cid:` — a signature logo or a tracking
   * pixel, not the invoice somebody is looking for. Surfaced rather than filtered
   * because the caller decides: a tile hides them, "save every attachment" does not.
   */
  inline: boolean;
}

/** An attachment's bytes, with the metadata needed to serve them. */
export interface MailboxAttachmentContent extends MailboxAttachment {
  bytes: ArrayBuffer;
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

/**
 * A live push subscription against one mailbox, as the adapter reports it.
 *
 * Three fields because the two providers disagree about all three, and collapsing
 * any two of them breaks one of them:
 *   • `subscriptionId` — Graph hands back a subscription resource to renew and
 *     delete. Gmail has no per-watch handle at all (the mailbox IS the watch), so
 *     it reports null.
 *   • `expiresAtMs`    — Gmail 7 days, Graph about 3. Both must be renewed BEFORE
 *     this instant or the mailbox silently stops notifying.
 *   • `cursor`         — how far we have read. Opaque above the adapter: a Gmail
 *     historyId, a Graph receivedDateTime instant.
 */
export interface MailboxWatchRegistration {
  /** `push` when the provider will notify us; `poll` when this deployment cannot
   *  receive one and the sweep must drain the same cursor itself. */
  mode: 'push' | 'poll';
  subscriptionId: string | null;
  cursor: string;
  expiresAtMs: number | null;
}

/** What the caller must give an adapter to register a push. */
export interface MailboxWatchTarget {
  /**
   * Where the provider should notify. Graph puts this on the subscription; Gmail
   * IGNORES it, because Gmail publishes to a Pub/Sub topic and the push
   * subscription on that topic — an operator artifact — is what carries the URL.
   */
  notifyUrl: string;
  /** Echoed back by Graph on every notification, so a guessed URL is not enough
   *  to forge one. Unused by Gmail, whose payload names the mailbox instead. */
  clientState: string;
  /** `projects/<p>/topics/<t>`. Gmail only; absent means poll mode. */
  pubsubTopic?: string;
}

/** Messages that arrived since `cursor`, and the cursor to store for next time. */
export interface MailboxDelta {
  messages: MailboxMessage[];
  cursor: string;
  /**
   * True when the provider could not honour the cursor (Gmail expires a historyId
   * after about a week) and the adapter re-baselined instead. The caller stores the
   * new cursor and must NOT treat the empty result as "nothing happened" in any
   * user-visible way — the mail in that gap is simply unrecoverable as a delta.
   */
  rebaselined?: boolean;
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
  setRead(accessToken: string, messageId: string, read: boolean): Promise<void>;
  sendMessage(accessToken: string, message: OutgoingMessage): Promise<{ id: string }>;
  /** What is attached to this message. Metadata only — see {@link MailboxAttachment}. */
  listAttachments(accessToken: string, messageId: string): Promise<MailboxAttachment[]>;
  /**
   * The bytes of ONE attachment, or null when the id names nothing on that
   * message. `maxBytes` is enforced by the ADAPTER, before the body is read into
   * memory where the provider makes that possible — a Worker has a hard memory
   * ceiling and "download it then check the size" is how that ceiling is hit.
   */
  readAttachment(
    accessToken: string,
    messageId: string,
    attachmentId: string,
    maxBytes: number,
  ): Promise<MailboxAttachmentContent | null>;

  // ── Push ──────────────────────────────────────────────────────────────────
  // The three calls that make a mailbox a CAUSE rather than something to re-read.
  // They are on the port and not beside it for the reason every other method is:
  // the two vendors express a subscription completely differently, and one shape
  // above them is what lets the workflow trigger and the canvas inbox tile share a
  // single registration instead of each registering its own.

  /** Register (or re-register) a push subscription and return the cursor to start
   *  reading from. Idempotent by contract: calling it again re-arms the clock. */
  startWatch(accessToken: string, target: MailboxWatchTarget): Promise<MailboxWatchRegistration>;

  /**
   * Extend an existing subscription without disturbing the cursor.
   *
   * Returns null when the provider cannot extend this one — Graph 404s a
   * subscription that already lapsed, Gmail has nothing to extend — which is the
   * caller's signal to call {@link startWatch} again rather than an error.
   */
  renewWatch(accessToken: string, registration: MailboxWatchRegistration, target: MailboxWatchTarget): Promise<MailboxWatchRegistration | null>;

  /** Best-effort teardown when a mailbox is disconnected. */
  stopWatch(accessToken: string, registration: MailboxWatchRegistration): Promise<void>;

  /** Everything that arrived after `cursor`, oldest first, plus the next cursor. */
  fetchDelta(accessToken: string, cursor: string | null, limit: number): Promise<MailboxDelta>;
}

/**
 * The ceiling on one attachment, in bytes.
 *
 * Not a policy choice — a Worker holds the whole body in memory to re-serve it,
 * and both providers hand it over base64-encoded, so the peak is roughly 1.4× the
 * file. 20 MB is comfortably inside the isolate's budget and above every invoice,
 * contract and deck anybody actually needs to open. Larger is refused BY NAME so
 * the person is told to open it in Gmail or Outlook rather than getting a failure
 * that looks like a bug.
 */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

/** The refusal for an attachment past {@link MAX_ATTACHMENT_BYTES}. */
export function attachmentTooLargeMessage(filename: string, byteSize: number): string {
  const mb = (n: number) => `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `"${filename}" is ${mb(byteSize)}, over the ${mb(MAX_ATTACHMENT_BYTES)} limit. Open it in your mail client instead.`;
}

/**
 * The one place a downloaded filename is made safe.
 *
 * The name comes from a sender — someone outside the tenant — and lands in a
 * `Content-Disposition` header and, on the far side, on a disk. Three things are
 * stripped for three different reasons: path separators (so `../../etc/passwd`
 * cannot escape a download directory), control characters and quotes (so the
 * header cannot be split or terminated early), and a leading dot (so a download
 * cannot be silently hidden).
 */
export function safeAttachmentFilename(raw: string): string {
  const cleaned = String(raw ?? '')
    .replace(/[\\/]+/g, '_')
    // Control characters (CR/LF included, so the header cannot be split), plus
    // the two quote forms that could terminate the filename parameter early.
    // eslint-disable-next-line no-control-regex -- header injection is the point
    .replace(/[\x00-\x1f\x7f"']/g, '')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 200);
  return cleaned || 'attachment';
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
/**
 * base64url → raw bytes. The decode step both text and binary parts share.
 *
 * Split out from `decodeBase64Url` because an ATTACHMENT must never go through a
 * `TextDecoder`: a PDF or a PNG run through UTF-8 decoding comes back with every
 * invalid sequence replaced by U+FFFD, and the file is silently corrupted rather
 * than failing. Text still decodes; bytes stay bytes.
 */
function base64UrlToBytes(input: string): ArrayBuffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0)).buffer;
}

function decodeBase64Url(input: string): string {
  try {
    return new TextDecoder().decode(base64UrlToBytes(input));
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

/** The OAuth/Graph/Gmail error envelope, when the body is one. */
interface ProviderErrorEnvelope {
  error?: { message?: string } | string;
  error_description?: string;
}

/** `null` for a non-JSON body — an HTML error page is a normal thing for a
 *  gateway to return, so the caller falls back to the raw text. */
function parseErrorEnvelope(body: string): ProviderErrorEnvelope | null {
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed && typeof parsed === 'object' ? (parsed as ProviderErrorEnvelope) : null;
  } catch {
    return null;
  }
}

/** Throw a readable error from a failed provider call rather than a bare status. */
async function providerError(label: string, res: Response): Promise<never> {
  const body = await res.text().catch(() => '');
  const truncated = body.slice(0, 300);
  const parsed = parseErrorEnvelope(body);
  const detail = (parsed
    ? (typeof parsed.error === 'object' ? parsed.error?.message : parsed.error) ?? parsed.error_description
    : undefined) ?? truncated;
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

/**
 * Every attachment on a Gmail message, from the same part tree `gmailBody` walks.
 *
 * The `filename && attachmentId` pair is what distinguishes an attachment from a
 * body part — a `text/html` part has data and no filename, and an inline image
 * has both plus a `Content-ID`. That last case is why `inline` is derived from
 * the headers rather than assumed: a signature logo is an attachment by every
 * structural test and is not what anybody means by one.
 */
function gmailAttachments(part: GmailPart | undefined): MailboxAttachment[] {
  const found: MailboxAttachment[] = [];
  const walk = (p: GmailPart | undefined): void => {
    if (!p) return;
    if (p.filename && p.body?.attachmentId) {
      const headers = new Map(
        (p.headers ?? []).map((h) => [String(h.name ?? '').toLowerCase(), String(h.value ?? '')]),
      );
      found.push({
        id: p.body.attachmentId,
        filename: p.filename,
        mimeType: p.mimeType || 'application/octet-stream',
        byteSize: Number(p.body.size ?? 0) || 0,
        inline: headers.has('content-id')
          || (headers.get('content-disposition') ?? '').toLowerCase().startsWith('inline'),
      });
    }
    for (const child of p.parts ?? []) walk(child);
  };
  walk(part);
  return found;
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
  // Modify permits read/unread + labels without granting permanent deletion.
  scopes: [
    'https://www.googleapis.com/auth/gmail.modify',
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

  async listAttachments(accessToken, messageId) {
    const res = await fetch(`${GMAIL_BASE}/messages/${encodeURIComponent(messageId)}?format=full`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 404) return [];
    if (!res.ok) return providerError('Gmail get', res);
    const raw = await res.json() as { payload?: GmailPart };
    return gmailAttachments(raw.payload);
  },

  /**
   * Gmail hands back the BYTES and nothing else — no filename, no content type —
   * so the message has to be walked first to learn what this attachment is. Two
   * round trips, and the alternative (trusting a filename the caller supplied) is
   * how a download ends up named after a different file than it contains.
   */
  async readAttachment(accessToken, messageId, attachmentId, maxBytes) {
    const meta = (await this.listAttachments(accessToken, messageId))
      .find((a) => a.id === attachmentId);
    if (!meta) return null;
    // Refused on the DECLARED size, before the body is fetched — that is the whole
    // reason the metadata call happens first rather than being an inconvenience.
    if (meta.byteSize > maxBytes) {
      throw new MailboxProviderError(attachmentTooLargeMessage(meta.filename, meta.byteSize), 413);
    }

    const res = await fetch(
      `${GMAIL_BASE}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (res.status === 404) return null;
    if (!res.ok) return providerError('Gmail attachment', res);
    const body = await res.json() as { data?: string; size?: number };
    if (!body.data) return null;
    const bytes = base64UrlToBytes(body.data);
    // Gmail's declared `size` and the decoded length can disagree on a re-encoded
    // part, so the REAL length is checked too — the ceiling protects memory, and
    // memory is spent on actual bytes, not on the number the provider reported.
    if (bytes.byteLength > maxBytes) {
      throw new MailboxProviderError(attachmentTooLargeMessage(meta.filename, bytes.byteLength), 413);
    }
    return { ...meta, byteSize: bytes.byteLength, bytes };
  },

  async setRead(accessToken, messageId, read) {
    const res = await fetch(`${GMAIL_BASE}/messages/${encodeURIComponent(messageId)}/modify`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(read ? { removeLabelIds: ['UNREAD'] } : { addLabelIds: ['UNREAD'] }),
    });
    if (!res.ok) return providerError('Gmail modify', res);
  },

  // ── Push (Gmail: users.watch + Pub/Sub, history.list for the delta) ────────

  /**
   * Arm a Gmail watch, or fall back to a cursor-only arm.
   *
   * `users.watch` publishes to a Pub/Sub TOPIC — there is no callback URL on this
   * call, which is why `target.notifyUrl` is unused here and why the absence of a
   * topic is not an error: without one the mailbox is armed in `poll` mode and the
   * sweep drains the identical `history.list` cursor on its own tick. Push makes it
   * instant; the fallback makes it late, never wrong.
   *
   * The cursor comes from the watch response when there is one and from the profile
   * otherwise, so both modes start from a real historyId rather than from zero
   * (which would replay the entire mailbox as "new").
   */
  async startWatch(accessToken, target) {
    if (!target.pubsubTopic) {
      const profile = await fetch(`${GMAIL_BASE}/profile`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!profile.ok) return providerError('Gmail profile', profile);
      const body = await profile.json() as { historyId?: string | number };
      return { mode: 'poll', subscriptionId: null, cursor: String(body.historyId ?? ''), expiresAtMs: null };
    }
    const res = await fetch(`${GMAIL_BASE}/watch`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      // INBOX only: a watch over every label re-notifies on a draft being saved and
      // on our own sends, which would fire a workflow for mail the tenant wrote.
      body: JSON.stringify({ topicName: target.pubsubTopic, labelIds: ['INBOX'], labelFilterBehavior: 'INCLUDE' }),
    });
    if (!res.ok) return providerError('Gmail watch', res);
    const body = await res.json() as { historyId?: string | number; expiration?: string | number };
    return {
      mode: 'push',
      subscriptionId: null,
      cursor: String(body.historyId ?? ''),
      // Gmail reports the expiry as epoch MILLISECONDS in a string.
      expiresAtMs: Number(body.expiration) || null,
    };
  },

  /**
   * Gmail has no extend operation — re-arming IS the renewal, and it deliberately
   * keeps the cursor the caller already holds rather than adopting the fresh
   * historyId the watch reports. Adopting it would skip every message that arrived
   * between the last drain and the renewal.
   */
  async renewWatch(accessToken, registration, target) {
    const armed = await this.startWatch(accessToken, target);
    return { ...armed, cursor: registration.cursor || armed.cursor };
  },

  async stopWatch(accessToken) {
    const res = await fetch(`${GMAIL_BASE}/stop`, {
      method: 'POST', headers: { Authorization: `Bearer ${accessToken}` },
    });
    // 404 means there was no watch to stop, which is the state we wanted anyway.
    if (!res.ok && res.status !== 404) return providerError('Gmail stop', res);
  },

  /**
   * Everything added since `cursor`, via `users.history.list`.
   *
   * Two things this must get right. `historyTypes=messageAdded` is what keeps a
   * read receipt or a label change from looking like new mail. And a 404 means the
   * cursor aged out (Gmail keeps roughly a week of history) — the only honest
   * response is to re-baseline from the profile and say so, because the mail in
   * that gap cannot be reconstructed as a delta and pretending otherwise would
   * either replay the mailbox or silently stall the cursor forever.
   */
  async fetchDelta(accessToken, cursor, limit) {
    const auth = { Authorization: `Bearer ${accessToken}` };
    const rebaseline = async (): Promise<MailboxDelta> => {
      const profile = await fetch(`${GMAIL_BASE}/profile`, { headers: auth });
      if (!profile.ok) return providerError('Gmail profile', profile);
      const body = await profile.json() as { historyId?: string | number };
      return { messages: [], cursor: String(body.historyId ?? ''), rebaselined: true };
    };
    if (!cursor) return rebaseline();

    const params = new URLSearchParams({
      startHistoryId: cursor,
      historyTypes: 'messageAdded',
      labelId: 'INBOX',
      maxResults: String(Math.max(1, Math.min(limit, MAILBOX_MAX_LIMIT))),
    });
    const res = await fetch(`${GMAIL_BASE}/history?${params}`, { headers: auth });
    if (res.status === 404) return rebaseline();
    if (!res.ok) return providerError('Gmail history', res);
    const body = await res.json() as {
      historyId?: string | number;
      history?: Array<{ messagesAdded?: Array<{ message?: { id?: string } }> }>;
    };
    const nextCursor = String(body.historyId ?? cursor);

    // De-duplicated here as well as in the receipt ledger: one history page can
    // name the same message in two entries, and fetching it twice would be two
    // needless round trips before the ledger ever sees it.
    const ids = [...new Set((body.history ?? [])
      .flatMap((entry) => entry.messagesAdded ?? [])
      .map((added) => String(added.message?.id ?? ''))
      .filter(Boolean))].slice(0, MAILBOX_MAX_LIMIT);
    if (ids.length === 0) return { messages: [], cursor: nextCursor };

    const settled = await Promise.allSettled(ids.map(async (id) => {
      const one = await fetch(`${GMAIL_BASE}/messages/${encodeURIComponent(id)}?format=full`, { headers: auth });
      // A message deleted between the notification and the read is not an error.
      if (one.status === 404) return null;
      if (!one.ok) return providerError('Gmail get', one);
      return gmailToMessage(await one.json() as Record<string, unknown>);
    }));
    const messages: MailboxMessage[] = [];
    for (const result of settled) {
      if (result.status === 'fulfilled') { if (result.value) messages.push(result.value); }
      else reportCaughtError(result.reason, {
        source: 'application/mailbox/mailboxProviders.ts', operation: 'googleMailbox.fetchDelta',
      });
    }
    messages.sort((a, b) => a.receivedAtISO.localeCompare(b.receivedAtISO));
    return { messages, cursor: nextCursor };
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

/** Graph's attachment resource, in the `$select` shape both calls above ask for. */
interface GraphAttachment {
  id?: string;
  name?: string;
  contentType?: string;
  size?: number;
  isInline?: boolean;
}

function graphToAttachment(raw: GraphAttachment): MailboxAttachment {
  return {
    id: String(raw.id ?? ''),
    filename: String(raw.name ?? 'attachment'),
    // Graph omits `contentType` on some item attachments; the octet-stream
    // fallback is what makes the download offer to SAVE rather than render
    // something the browser guessed at.
    mimeType: String(raw.contentType ?? '') || 'application/octet-stream',
    byteSize: Number(raw.size ?? 0) || 0,
    inline: raw.isInline === true,
  };
}

/**
 * How long a Graph mail subscription is asked to live.
 *
 * Graph caps an Outlook message subscription at 4230 minutes (a little under three
 * days) and rejects anything longer outright. 4200 leaves half an hour of slack so
 * a clock skew between this Worker and Graph cannot turn a valid request into a
 * 400 — which is the failure mode that would silently stop every renewal.
 */
const GRAPH_SUBSCRIPTION_TTL_MS = 4_200 * 60 * 1000;

/**
 * The instant of the newest message already in the inbox — the cursor a fresh
 * watch starts from.
 *
 * Starting from "now" instead would drop anything that arrived between the consent
 * redirect and this call; starting from zero would replay the entire mailbox as new
 * mail and fire a workflow for every message the tenant has ever received.
 */
async function graphNewestReceivedAt(accessToken: string): Promise<string> {
  const params = new URLSearchParams({
    $select: 'receivedDateTime', $orderby: 'receivedDateTime desc', $top: '1',
  });
  const res = await fetch(`${GRAPH_BASE}/mailFolders('inbox')/messages?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return providerError('Graph newest message', res);
  const body = await res.json() as { value?: Array<{ receivedDateTime?: string }> };
  const newest = body.value?.[0]?.receivedDateTime;
  return newest ? toIso(newest) : new Date().toISOString();
}

const microsoftMailbox: MailboxProvider = {
  name: 'microsoft',
  label: 'Microsoft 365',
  // `common` rather than a tenant id: a Builderforce customer's Microsoft tenant
  // is not ours, and pinning our own would make every external mailbox unconnectable.
  authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
  tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
  // Mail.ReadWrite enables read/unread state; delete is never exposed. `offline_access` is what yields the
  // refresh token; without it Graph returns a 1-hour token and nothing else.
  scopes: ['offline_access', 'openid', 'email', 'profile', 'Mail.ReadWrite', 'Mail.Send', 'User.Read'],
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

  async setRead(accessToken, messageId, read) {
    const res = await fetch(`${GRAPH_BASE}/messages/${encodeURIComponent(messageId)}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ isRead: read }),
    });
    if (!res.ok) return providerError('Graph update message', res);
  },

  async listAttachments(accessToken, messageId) {
    // `$select` excludes `contentBytes`, which is the whole point: without it
    // Graph inlines every attachment's base64 into the LISTING, so asking "what is
    // attached" would download all of it.
    const res = await fetch(
      `${GRAPH_BASE}/messages/${encodeURIComponent(messageId)}/attachments?$select=id,name,contentType,size,isInline`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (res.status === 404) return [];
    if (!res.ok) return providerError('Graph attachments', res);
    const body = await res.json() as { value?: GraphAttachment[] };
    return (body.value ?? []).map(graphToAttachment);
  },

  async readAttachment(accessToken, messageId, attachmentId, maxBytes) {
    const base = `${GRAPH_BASE}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`;
    // Metadata first, for the same reason Gmail needs it: the size is refused
    // BEFORE the bytes are pulled into the isolate.
    const metaRes = await fetch(`${base}?$select=id,name,contentType,size,isInline`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (metaRes.status === 404) return null;
    if (!metaRes.ok) return providerError('Graph attachment', metaRes);
    const meta = graphToAttachment(await metaRes.json() as GraphAttachment);
    if (meta.byteSize > maxBytes) {
      throw new MailboxProviderError(attachmentTooLargeMessage(meta.filename, meta.byteSize), 413);
    }

    // `/$value` streams the raw bytes. The alternative — re-reading the resource
    // for its base64 `contentBytes` — costs 33% more transfer and only works for
    // `fileAttachment`; `$value` also serves an `itemAttachment` as its MIME.
    const res = await fetch(`${base}/$value`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.status === 404) return null;
    if (!res.ok) {
      // A reference attachment (a OneDrive link, not a file) has no bytes to
      // serve. Named, because "download failed" would send somebody hunting for a
      // network problem that is not there.
      if (res.status === 400) {
        throw new MailboxProviderError(
          `"${meta.filename}" is a link to a cloud file, not an attached file. Open it from the message instead.`,
          415,
        );
      }
      return providerError('Graph attachment content', res);
    }
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength > maxBytes) {
      throw new MailboxProviderError(attachmentTooLargeMessage(meta.filename, bytes.byteLength), 413);
    }
    return { ...meta, byteSize: bytes.byteLength, bytes };
  },

  // ── Push (Graph: /subscriptions + a receivedDateTime cursor) ──────────────

  /**
   * Create a Graph change subscription on the inbox.
   *
   * Creation is a HANDSHAKE, and it happens INSIDE this call: Graph immediately
   * calls `notificationUrl` with `?validationToken=<opaque>` and refuses the
   * subscription unless the endpoint answers 200 with that token as `text/plain`.
   * That is why the push route has to accept an unauthenticated request and answer
   * the validation before anything else — see `mailboxPushRoutes`.
   *
   * The cursor is the newest `receivedDateTime` already in the mailbox, NOT a delta
   * token. Graph delta requires walking the entire folder to reach the first
   * `@odata.deltaLink`, which on a real mailbox is thousands of requests spent to
   * learn a fact a single `$top=1` query answers — and every subsequent read is the
   * same `$filter=receivedDateTime gt <cursor>` either way.
   */
  async startWatch(accessToken, target) {
    const cursor = await graphNewestReceivedAt(accessToken);
    const expiresAtMs = Date.now() + GRAPH_SUBSCRIPTION_TTL_MS;
    const res = await fetch('https://graph.microsoft.com/v1.0/subscriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        changeType: 'created',
        notificationUrl: target.notifyUrl,
        resource: "/me/mailFolders('inbox')/messages",
        expirationDateTime: new Date(expiresAtMs).toISOString(),
        clientState: target.clientState,
      }),
    });
    if (!res.ok) return providerError('Graph subscribe', res);
    const body = await res.json() as { id?: string; expirationDateTime?: string };
    return {
      mode: 'push',
      subscriptionId: String(body.id ?? ''),
      cursor,
      expiresAtMs: Date.parse(String(body.expirationDateTime ?? '')) || expiresAtMs,
    };
  },

  /**
   * PATCH the expiry. A 404 means the subscription already lapsed and cannot be
   * extended — returning null rather than throwing is what tells the sweep to
   * create a fresh one instead of marking the mailbox broken.
   */
  async renewWatch(accessToken, registration) {
    if (!registration.subscriptionId) return null;
    const expiresAtMs = Date.now() + GRAPH_SUBSCRIPTION_TTL_MS;
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/subscriptions/${encodeURIComponent(registration.subscriptionId)}`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ expirationDateTime: new Date(expiresAtMs).toISOString() }),
      },
    );
    if (res.status === 404 || res.status === 410) return null;
    if (!res.ok) return providerError('Graph renew subscription', res);
    const body = await res.json() as { expirationDateTime?: string };
    return {
      ...registration,
      expiresAtMs: Date.parse(String(body.expirationDateTime ?? '')) || expiresAtMs,
    };
  },

  async stopWatch(accessToken, registration) {
    if (!registration.subscriptionId) return;
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/subscriptions/${encodeURIComponent(registration.subscriptionId)}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } },
    );
    // Already gone is the outcome we asked for.
    if (!res.ok && res.status !== 404 && res.status !== 410) return providerError('Graph unsubscribe', res);
  },

  /**
   * Everything received strictly after `cursor`, oldest first.
   *
   * `gt` and not `ge` on purpose: the boundary message is the one the cursor was
   * SET from, and re-emitting it on every drain is exactly the double-fire the
   * receipt ledger exists to catch — it should never have to.
   */
  async fetchDelta(accessToken, cursor, limit) {
    if (!cursor) return { messages: [], cursor: await graphNewestReceivedAt(accessToken), rebaselined: true };
    const since = new Date(cursor);
    if (Number.isNaN(since.getTime())) {
      return { messages: [], cursor: await graphNewestReceivedAt(accessToken), rebaselined: true };
    }
    const params = new URLSearchParams({
      $select: GRAPH_SELECT,
      $filter: `receivedDateTime gt ${since.toISOString()}`,
      $orderby: 'receivedDateTime asc',
      $top: String(Math.max(1, Math.min(limit, MAILBOX_MAX_LIMIT))),
    });
    const res = await fetch(`${GRAPH_BASE}/mailFolders('inbox')/messages?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return providerError('Graph delta', res);
    const body = await res.json() as { value?: GraphMessage[] };
    const messages = (body.value ?? []).map(graphToMessage);
    // Advance only as far as we actually read. A page cut short by `$top` leaves the
    // cursor on the last message we HAVE, so the next drain resumes rather than skips.
    const nextCursor = messages.length
      ? messages[messages.length - 1]!.receivedAtISO
      : since.toISOString();
    return { messages, cursor: nextCursor };
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
