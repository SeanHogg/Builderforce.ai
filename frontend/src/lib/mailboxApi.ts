import { apiRequest } from './apiClient';

/**
 * Connected mailboxes — Microsoft 365 and Gmail.
 *
 * Server counterpart: `api/src/presentation/routes/mailboxRoutes.ts`.
 *
 * Connecting is a top-level browser NAVIGATION, not a fetch: the provider's
 * consent screen is a full-page redirect and cannot be framed. `connect()`
 * therefore returns the URL for the caller to navigate to rather than doing it —
 * an authenticated fetch gets the URL, then the browser makes the jump.
 */

export type MailboxProviderName = 'microsoft' | 'google';

export interface MailboxProviderInfo {
  name: MailboxProviderName;
  label: string;
  /** False when this deployment has no OAuth app bound for the provider. The UI
   *  must show it as unavailable rather than offering a redirect that 503s. */
  configured: boolean;
}

export interface MailboxConnection {
  id: number;
  provider: MailboxProviderName;
  accountEmail: string;
  displayName: string;
  status: 'connected' | 'expired' | 'revoked' | string;
  /** Whether campaigns may send from this mailbox. Reading is unaffected. */
  allowSending: boolean;
  lastError: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
}

/** One message, already normalized across providers by the server. */
export interface MailboxMessage {
  id: string;
  threadId: string | null;
  from: string;
  fromName: string;
  to: string[];
  subject: string;
  snippet: string;
  bodyText: string;
  receivedAtISO: string;
  unread: boolean;
  hasAttachments: boolean;
  labels: string[];
  webUrl: string | null;
}

/** The compact projection — what a canvas tile renders and a model reads. */
export interface TriageMessage {
  id: string;
  from: string;
  fromName: string;
  subject: string;
  receivedAtISO: string;
  unread: boolean;
  hasAttachments: boolean;
  excerpt: string;
}

export interface MailboxFilter {
  q?: string;
  from?: string;
  subject?: string;
  unread?: boolean;
  hasAttachments?: boolean;
  after?: string;
  before?: string;
  limit?: number;
}

export type MailboxResponseMode = 'draft' | 'approval' | 'automatic';

export interface MailboxAutomationRule {
  id: number;
  connectionId: number;
  name: string;
  enabled: boolean;
  fromContains: string;
  subjectContains: string;
  agentRef: string | null;
  responseMode: MailboxResponseMode;
  instructions: string;
  createdAt: string;
  updatedAt: string;
}

export type MailboxAutomationRuleInput = Pick<MailboxAutomationRule, 'name' | 'enabled' | 'fromContains' | 'subjectContains' | 'agentRef' | 'responseMode' | 'instructions'>;

const MAILBOX = '/api/mailbox';

/** Serialize a filter into the query string the server's ONE parser reads.
 *  Empty values are dropped so an absent filter and a blank one mean the same
 *  thing on both sides. */
export function mailboxFilterQuery(filter: MailboxFilter = {}): string {
  const params = new URLSearchParams();
  if (filter.q?.trim()) params.set('q', filter.q.trim());
  if (filter.from?.trim()) params.set('from', filter.from.trim());
  if (filter.subject?.trim()) params.set('subject', filter.subject.trim());
  if (filter.unread) params.set('unread', 'true');
  if (filter.hasAttachments) params.set('hasAttachments', 'true');
  if (filter.after) params.set('after', filter.after);
  if (filter.before) params.set('before', filter.before);
  if (filter.limit) params.set('limit', String(filter.limit));
  const query = params.toString();
  return query ? `?${query}` : '';
}

/**
 * A one-line, human description of what a filter selects.
 *
 * Used as the inbox tile's subtitle. A tile labelled only "Inbox" is a lie once
 * a filter is applied — the reader has no way to tell a filtered view from the
 * whole mailbox, and would take "3 messages" to mean they have three emails.
 */
export function describeMailboxFilter(filter: MailboxFilter = {}): string {
  const parts: string[] = [];
  if (filter.unread) parts.push('Unread');
  if (filter.from?.trim()) parts.push(`from ${filter.from.trim()}`);
  if (filter.subject?.trim()) parts.push(`subject “${filter.subject.trim()}”`);
  if (filter.q?.trim()) parts.push(`matching “${filter.q.trim()}”`);
  if (filter.hasAttachments) parts.push('with attachments');
  if (filter.after) parts.push(`since ${filter.after.slice(0, 10)}`);
  if (filter.before) parts.push(`before ${filter.before.slice(0, 10)}`);
  if (parts.length === 0) return 'All recent mail';
  // Capitalise only when "Unread" did not already lead.
  const text = parts.join(', ');
  return filter.unread ? text : text.charAt(0).toUpperCase() + text.slice(1);
}

export const mailboxApi = {
  providers: (): Promise<{ providers: MailboxProviderInfo[]; connections: MailboxConnection[] }> =>
    apiRequest(`${MAILBOX}/providers`),

  listConnections: (): Promise<{ connections: MailboxConnection[] }> =>
    apiRequest(`${MAILBOX}/connections`),

  /** Returns the provider consent URL. The caller navigates — see the note above. */
  connect: (provider: MailboxProviderName, returnTo = '/growth'): Promise<{ authUrl: string }> =>
    apiRequest(`${MAILBOX}/connect/${provider}?returnTo=${encodeURIComponent(returnTo)}`),

  setSending: (connectionId: number, allowSending: boolean): Promise<MailboxConnection> =>
    apiRequest(`${MAILBOX}/connections/${connectionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allowSending }),
    }),

  disconnect: (connectionId: number): Promise<void> =>
    apiRequest(`${MAILBOX}/connections/${connectionId}`, { method: 'DELETE' }),

  listMessages: (
    connectionId: number,
    filter: MailboxFilter = {},
  ): Promise<{
    messages: MailboxMessage[];
    triage: TriageMessage[];
    accountEmail: string;
    provider: MailboxProviderName;
  }> => apiRequest(`${MAILBOX}/connections/${connectionId}/messages${mailboxFilterQuery(filter)}`),

  getMessage: (connectionId: number, messageId: string): Promise<MailboxMessage> =>
    apiRequest(`${MAILBOX}/connections/${connectionId}/messages/${encodeURIComponent(messageId)}`),

  send: (connectionId: number, message: { to: string; subject: string; html: string; replyTo?: string }): Promise<{ sent: true; id: string; accountEmail: string }> =>
    apiRequest(`${MAILBOX}/connections/${connectionId}/send`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(message),
    }),

  listRules: (connectionId: number): Promise<{ rules: MailboxAutomationRule[] }> =>
    apiRequest(`${MAILBOX}/connections/${connectionId}/rules`),

  createRule: (connectionId: number, rule: MailboxAutomationRuleInput): Promise<MailboxAutomationRule> =>
    apiRequest(`${MAILBOX}/connections/${connectionId}/rules`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rule),
    }),

  updateRule: (ruleId: number, patch: Partial<MailboxAutomationRuleInput>): Promise<MailboxAutomationRule> =>
    apiRequest(`${MAILBOX}/rules/${ruleId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    }),

  deleteRule: (ruleId: number): Promise<void> =>
    apiRequest(`${MAILBOX}/rules/${ruleId}`, { method: 'DELETE' }),
};

/**
 * Which mailbox a caller meant — the client mirror of the server's
 * `resolveMailbox`.
 *
 * The rule is deliberately the same on both sides: a named address wins, a
 * single usable mailbox is assumed, and two-with-no-name is an ambiguity to
 * report rather than guess at. Two different rules would mean the canvas tile
 * and the agent tool silently picked different mailboxes for the same request.
 */
export function resolveMailboxConnection(
  connections: MailboxConnection[],
  ref: { connectionId?: number | null; accountEmail?: string | null } = {},
  opts: { forSending?: boolean } = {},
): { ok: true; connection: MailboxConnection } | { ok: false; error: string } {
  const usable = opts.forSending
    ? connections.filter((c) => c.allowSending && c.status === 'connected')
    : connections.filter((c) => c.status !== 'revoked');

  if (ref.connectionId != null) {
    const match = connections.find((c) => c.id === ref.connectionId);
    if (!match) return { ok: false, error: 'That mailbox is not connected to this workspace.' };
    return { ok: true, connection: match };
  }
  const email = ref.accountEmail?.trim().toLowerCase();
  if (email) {
    const match = usable.find((c) => c.accountEmail === email);
    return match
      ? { ok: true, connection: match }
      : { ok: false, error: `No connected mailbox for ${email}.` };
  }
  if (usable.length === 1) return { ok: true, connection: usable[0]! };
  if (usable.length === 0) return { ok: false, error: 'No mailbox is connected.' };
  return {
    ok: false,
    error: `Several mailboxes are connected (${usable.map((c) => c.accountEmail).join(', ')}). Name which one to use.`,
  };
}
