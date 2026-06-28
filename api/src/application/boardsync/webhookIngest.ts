/**
 * Webhook ingest helpers — HMAC verification + provider payload normalization.
 *
 * No DB/network IO. The HMAC verify uses Web Crypto (Worker-compatible) and
 * mirrors githubWebhookRoutes' verification. Normalization maps a raw provider
 * webhook body into the same field bag the polling path produces, so both paths
 * feed the identical reconciler.
 */

import { hmacSha256Hex, hmacSha256Base64Url, timingSafeEqualHex } from '../../infrastructure/crypto/webhookHmac';

/** Normalized result of a webhook body, ready to hand to the reconciler. */
export interface NormalizedWebhookTicket {
  externalId:      string;
  externalUrl:     string | null;
  externalVersion: string | null;
  title:           string;
  body:            string | null;
  state:           string;
  fields:          Record<string, unknown>;
  /** True when the event author is our own integration actor (echo). */
  originatedLocally: boolean;
}

/**
 * Verify an HMAC-SHA256 webhook signature of the form "sha256=<hex>".
 * Returns false on any malformed input rather than throwing. Used by the
 * GitHub/Jira-style scheme and as the generic fallback.
 */
export async function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
): Promise<boolean> {
  try {
    if (!signatureHeader.startsWith('sha256=')) return false;
    const expected = signatureHeader.slice('sha256='.length);
    if (!expected) return false;
    return timingSafeEqualHex(await hmacSha256Hex(secret, rawBody), expected);
  } catch {
    return false;
  }
}

/** Reads a request header by name (case-insensitive at the Hono layer). */
export type HeaderGetter = (name: string) => string | undefined | null;

/**
 * Provider-aware webhook signature verification. Each provider signs differently;
 * trust is the per-connection `webhook_secret` in every case:
 *   - github / jira  → `X-Hub-Signature-256: sha256=<hex>` over the raw body
 *   - linear         → `Linear-Signature: <hex>` (HMAC-SHA256, no prefix)
 *   - sentry         → `Sentry-Hook-Signature: <hex>` (HMAC-SHA256)
 *   - pagerduty      → `X-PagerDuty-Signature: v1=<hex>[,v1=<hex>…]` (any match wins)
 *   - monday         → HS256 JWT in `Authorization` signed with the secret
 *   - other          → generic `sha256=<hex>` fallback
 * Returns false on any malformed input rather than throwing.
 */
export async function verifyProviderWebhookSignature(
  provider: string,
  rawBody: string,
  getHeader: HeaderGetter,
  secret: string,
): Promise<boolean> {
  try {
    switch (provider) {
      case 'github':
      case 'jira': {
        const sig = getHeader('X-Hub-Signature-256') ?? getHeader('X-Board-Signature-256') ?? getHeader('X-Signature-256') ?? '';
        return verifyWebhookSignature(rawBody, sig, secret);
      }
      case 'linear': {
        const sig = (getHeader('Linear-Signature') ?? '').trim();
        return sig.length > 0 && timingSafeEqualHex(await hmacSha256Hex(secret, rawBody), sig);
      }
      case 'sentry': {
        const sig = (getHeader('Sentry-Hook-Signature') ?? '').trim();
        return sig.length > 0 && timingSafeEqualHex(await hmacSha256Hex(secret, rawBody), sig);
      }
      case 'pagerduty': {
        const header = getHeader('X-PagerDuty-Signature') ?? '';
        const expected = await hmacSha256Hex(secret, rawBody);
        const sigs = header.split(',').map((s) => s.trim()).filter((s) => s.startsWith('v1=')).map((s) => s.slice(3));
        return sigs.some((s) => timingSafeEqualHex(expected, s));
      }
      case 'monday':
        return verifyMondayJwt(getHeader('Authorization') ?? '', secret);
      default: {
        const sig = getHeader('X-Board-Signature-256') ?? getHeader('X-Signature-256') ?? '';
        return verifyWebhookSignature(rawBody, sig, secret);
      }
    }
  } catch {
    return false;
  }
}

/** Verify a monday.com HS256 JWT (header.payload.signature) signed with the secret. */
async function verifyMondayJwt(authHeader: string, secret: string): Promise<boolean> {
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  const [h, p, sig] = token.split('.');
  if (!h || !p || !sig) return false;
  const expected = await hmacSha256Base64Url(secret, `${h}.${p}`);
  return timingSafeEqualHex(expected, sig);
}

interface GitHubIssueWebhook {
  issue?: {
    number?: number;
    title?: string;
    body?: string | null;
    html_url?: string;
    state?: string;
    updated_at?: string;
    user?: { login?: string; type?: string };
  };
  sender?: { login?: string; type?: string };
}

interface JiraWebhook {
  issue?: {
    key?: string;
    self?: string;
    fields?: {
      summary?: string;
      description?: string | null;
      updated?: string;
      status?: { name?: string };
    };
  };
  user?: { accountId?: string; displayName?: string };
}

/**
 * Normalize a raw webhook body for the given provider.
 * Returns null when the body carries no actionable ticket.
 */
export function normalizeWebhookPayload(provider: string, payload: unknown): NormalizedWebhookTicket | null {
  switch (provider) {
    case 'github':
      return normalizeGitHub(payload as GitHubIssueWebhook);
    case 'jira':
      return normalizeJira(payload as JiraWebhook);
    case 'linear':
      return normalizeLinear(payload as LinearWebhook);
    case 'sentry':
      return normalizeSentry(payload as SentryWebhook);
    case 'pagerduty':
      return normalizePagerDuty(payload as PagerDutyWebhook);
    case 'monday':
      return normalizeMonday(payload as MondayWebhook);
    default:
      return null;
  }
}

function normalizeGitHub(p: GitHubIssueWebhook): NormalizedWebhookTicket | null {
  const issue = p.issue;
  if (!issue || issue.number == null) return null;
  const fields: Record<string, unknown> = {
    title: issue.title ?? '',
    body: issue.body ?? '',
    state: issue.state ?? 'open',
  };
  // Bot/integration-authored events are echoes of our own writes.
  const originatedLocally = (p.sender?.type ?? issue.user?.type) === 'Bot';
  return {
    externalId: String(issue.number),
    externalUrl: issue.html_url ?? null,
    externalVersion: issue.updated_at ?? null,
    title: issue.title ?? '',
    body: issue.body ?? null,
    state: issue.state ?? 'open',
    fields,
    originatedLocally,
  };
}

function normalizeJira(p: JiraWebhook): NormalizedWebhookTicket | null {
  const issue = p.issue;
  if (!issue || !issue.key) return null;
  const f = issue.fields ?? {};
  const body = typeof f.description === 'string' ? f.description : f.description ? JSON.stringify(f.description) : null;
  const fields: Record<string, unknown> = {
    title: f.summary ?? '',
    body: body ?? '',
    state: f.status?.name ?? 'unknown',
  };
  return {
    externalId: issue.key,
    externalUrl: issue.self ?? null,
    externalVersion: f.updated ?? null,
    title: f.summary ?? '',
    body,
    state: f.status?.name ?? 'unknown',
    fields,
    originatedLocally: false,
  };
}

/** Small helper — build the field bag + ticket from already-extracted parts. */
function makeTicket(parts: {
  externalId: string;
  externalUrl: string | null;
  externalVersion: string | null;
  title: string;
  body: string | null;
  state: string;
  originatedLocally?: boolean;
}): NormalizedWebhookTicket {
  return {
    externalId: parts.externalId,
    externalUrl: parts.externalUrl,
    externalVersion: parts.externalVersion,
    title: parts.title,
    body: parts.body,
    state: parts.state,
    fields: { title: parts.title, body: parts.body ?? '', state: parts.state },
    originatedLocally: parts.originatedLocally ?? false,
  };
}

interface LinearWebhook {
  type?: string;
  data?: {
    id?: string;
    identifier?: string;
    title?: string;
    description?: string | null;
    url?: string;
    updatedAt?: string;
    state?: { name?: string };
  };
}

function normalizeLinear(p: LinearWebhook): NormalizedWebhookTicket | null {
  if (p.type && p.type !== 'Issue') return null;
  const d = p.data;
  if (!d?.id) return null;
  return makeTicket({
    externalId: d.id,
    externalUrl: d.url ?? null,
    externalVersion: d.updatedAt ?? null,
    title: d.title ?? '',
    body: d.description ?? null,
    state: d.state?.name ?? 'unknown',
  });
}

interface SentryWebhook {
  data?: { issue?: SentryIssueBody };
  issue?: SentryIssueBody;
}
interface SentryIssueBody {
  id?: string;
  title?: string;
  culprit?: string | null;
  permalink?: string;
  status?: string;
  lastSeen?: string;
}

function normalizeSentry(p: SentryWebhook): NormalizedWebhookTicket | null {
  const issue = p.data?.issue ?? p.issue;
  if (!issue?.id) return null;
  return makeTicket({
    externalId: issue.id,
    externalUrl: issue.permalink ?? null,
    externalVersion: issue.lastSeen ?? null,
    title: issue.title ?? '',
    body: issue.culprit ?? null,
    state: issue.status ?? 'unresolved',
  });
}

interface PagerDutyWebhook {
  event?: {
    data?: {
      id?: string;
      title?: string;
      summary?: string;
      status?: string;
      html_url?: string;
      created_at?: string;
    };
  };
}

function normalizePagerDuty(p: PagerDutyWebhook): NormalizedWebhookTicket | null {
  const d = p.event?.data;
  if (!d?.id) return null;
  const title = d.title ?? d.summary ?? '';
  return makeTicket({
    externalId: d.id,
    externalUrl: d.html_url ?? null,
    externalVersion: d.created_at ?? null,
    title,
    body: title,
    state: d.status ?? 'triggered',
  });
}

interface MondayWebhook {
  event?: {
    pulseId?: number | string;
    pulseName?: string;
    triggerTime?: string;
    value?: { label?: { text?: string } };
  };
}

function normalizeMonday(p: MondayWebhook): NormalizedWebhookTicket | null {
  const e = p.event;
  if (!e?.pulseId) return null;
  return makeTicket({
    externalId: String(e.pulseId),
    externalUrl: null,
    externalVersion: e.triggerTime ?? null,
    title: e.pulseName ?? '',
    body: null,
    state: e.value?.label?.text ?? 'active',
  });
}
