/**
 * Webhook ingest helpers — HMAC verification + provider payload normalization.
 *
 * No DB/network IO. The HMAC verify uses Web Crypto (Worker-compatible) and
 * mirrors githubWebhookRoutes' verification. Normalization maps a raw provider
 * webhook body into the same field bag the polling path produces, so both paths
 * feed the identical reconciler.
 */

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
 * Returns false on any malformed input rather than throwing.
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
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
    const hex = Array.from(new Uint8Array(mac))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return timingSafeEqualHex(hex, expected);
  } catch {
    return false;
  }
}

/** Constant-time-ish hex string compare (avoids early-exit on length-equal inputs). */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
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
