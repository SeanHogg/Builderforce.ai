/**
 * Connected mailboxes — persistence, token lifecycle, and the read/send surface.
 *
 * The routes, the canvas inbox, the campaign send engine and the MCP tools all
 * come through here; none of them touch a provider adapter or a token directly.
 * That is what makes the two invariants below enforceable in one place:
 *
 *   1. A TOKEN IS NEVER RETURNED. `MailboxConnectionView` is what every caller
 *      sees, and it carries no secret. The sealed blob is opened only inside
 *      {@link freshMailboxToken} and never leaves this module.
 *   2. A REVOKED GRANT SAYS SO. When a refresh fails with 400/401 the row is
 *      marked `revoked` — a refresh token is rejected permanently once the user
 *      removes consent, and retrying it every batch would turn one revocation
 *      into a stream of identical failures with no signal to reconnect.
 *
 * Sealing uses the shared per-tenant AES-256-GCM credential crypto rather than
 * the plaintext columns `calendar_connections` (0292) uses. That table is the
 * outlier; a mailbox grant can read a company's entire correspondence and send
 * as them, so it gets the same treatment as any other stored credential.
 */

import { and, asc, eq, sql } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { mailboxConnections } from '../../infrastructure/database/schema';
import { refreshAccessToken } from '../../infrastructure/auth/oauthState';
import {
  isTerminalRefreshFailure,
  mergeRefreshedTokens,
  oauthTokensStale,
  sealOAuthTokens,
  unsealOAuthTokens,
} from '../integrations/oauthTokenVault';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import {
  clampMailboxLimit,
  getMailboxProvider,
  MailboxProviderError,
  type MailboxMessage,
  type MailboxProvider,
  type MailboxProviderName,
  type MailboxQuery,
  type OutgoingMessage,
} from './mailboxProviders';

/** What every caller outside this module sees. Deliberately carries no token. */
export interface MailboxConnectionView {
  id: number;
  provider: MailboxProviderName;
  accountEmail: string;
  displayName: string;
  status: 'connected' | 'expired' | 'revoked' | string;
  allowSending: boolean;
  lastError: string | null;
  lastSyncedAt: Date | null;
  createdAt: Date;
}

const VIEW_COLUMNS = {
  id: mailboxConnections.id,
  provider: mailboxConnections.provider,
  accountEmail: mailboxConnections.accountEmail,
  displayName: mailboxConnections.displayName,
  status: mailboxConnections.status,
  allowSending: mailboxConnections.allowSending,
  lastError: mailboxConnections.lastError,
  lastSyncedAt: mailboxConnections.lastSyncedAt,
  createdAt: mailboxConnections.createdAt,
} as const;

function toView(row: typeof VIEW_COLUMNS extends never ? never : {
  id: number; provider: string; accountEmail: string; displayName: string;
  status: string; allowSending: boolean; lastError: string | null;
  lastSyncedAt: Date | null; createdAt: Date;
}): MailboxConnectionView {
  return { ...row, provider: row.provider as MailboxProviderName };
}

// ---------------------------------------------------------------------------
// Connection lifecycle
// ---------------------------------------------------------------------------

/**
 * Persist a completed OAuth grant, replacing any previous grant on the same
 * mailbox.
 *
 * The upsert target is the natural key (tenant, user, provider, account), so
 * re-consenting refreshes the grant in place rather than accumulating a row per
 * consent — and, importantly, RESETS `status` to `connected`, which is how a
 * user recovers a revoked mailbox by simply reconnecting it.
 */
export async function saveMailboxConnection(
  db: Db,
  env: Env,
  input: {
    tenantId: number;
    userId: string;
    provider: MailboxProviderName;
    accountEmail: string;
    displayName?: string;
    accessToken: string;
    refreshToken?: string;
    expiresInSeconds?: number;
    scope?: string;
  },
): Promise<MailboxConnectionView> {
  const expiresAtMs = input.expiresInSeconds
    ? Date.now() + input.expiresInSeconds * 1000
    : undefined;
  const sealed = await sealOAuthTokens(env, input.tenantId, {
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    expiresAtMs,
    scope: input.scope,
  });

  const [row] = await db
    .insert(mailboxConnections)
    .values({
      tenantId: input.tenantId,
      userId: input.userId,
      provider: input.provider,
      accountEmail: input.accountEmail.toLowerCase(),
      displayName: (input.displayName ?? '').slice(0, 255),
      tokenEnc: sealed.enc,
      tokenIv: sealed.iv,
      expiresAt: expiresAtMs ? new Date(expiresAtMs) : null,
      scope: input.scope ?? '',
      status: 'connected',
      lastError: null,
    })
    .onConflictDoUpdate({
      target: [
        mailboxConnections.tenantId, mailboxConnections.userId,
        mailboxConnections.provider, mailboxConnections.accountEmail,
      ],
      set: {
        tokenEnc: sealed.enc,
        tokenIv: sealed.iv,
        expiresAt: expiresAtMs ? new Date(expiresAtMs) : null,
        scope: input.scope ?? '',
        displayName: (input.displayName ?? '').slice(0, 255),
        // Reconnecting IS the recovery path for a revoked grant.
        status: 'connected',
        lastError: null,
        updatedAt: sql`NOW()`,
      },
    })
    .returning(VIEW_COLUMNS);
  return toView(row!);
}

/** Every mailbox this tenant has connected. Tenant-wide, not per-user: a
 *  campaign is a tenant artifact and must still send after its author is on
 *  holiday. `allowSending` is the per-mailbox opt-out. */
export async function listMailboxConnections(db: Db, tenantId: number): Promise<MailboxConnectionView[]> {
  const rows = await db
    .select(VIEW_COLUMNS)
    .from(mailboxConnections)
    .where(eq(mailboxConnections.tenantId, tenantId))
    .orderBy(asc(mailboxConnections.id));
  return rows.map(toView);
}

export async function getMailboxConnection(
  db: Db,
  tenantId: number,
  connectionId: number,
): Promise<MailboxConnectionView | null> {
  const [row] = await db
    .select(VIEW_COLUMNS)
    .from(mailboxConnections)
    .where(and(eq(mailboxConnections.id, connectionId), eq(mailboxConnections.tenantId, tenantId)))
    .limit(1);
  return row ? toView(row) : null;
}

export async function deleteMailboxConnection(db: Db, tenantId: number, connectionId: number): Promise<void> {
  await db
    .delete(mailboxConnections)
    .where(and(eq(mailboxConnections.id, connectionId), eq(mailboxConnections.tenantId, tenantId)));
}

/** Toggle whether campaigns may send from this mailbox. Reading is unaffected —
 *  a shared inbox can be on the canvas without being a sending identity. */
export async function setMailboxSending(
  db: Db,
  tenantId: number,
  connectionId: number,
  allowSending: boolean,
): Promise<MailboxConnectionView | null> {
  const [row] = await db
    .update(mailboxConnections)
    .set({ allowSending, updatedAt: sql`NOW()` })
    .where(and(eq(mailboxConnections.id, connectionId), eq(mailboxConnections.tenantId, tenantId)))
    .returning(VIEW_COLUMNS);
  return row ? toView(row) : null;
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

export type TokenResult =
  | { ok: true; accessToken: string; provider: MailboxProvider; accountEmail: string }
  | { ok: false; status: 'revoked' | 'expired' | 'unavailable'; error: string };

/**
 * A usable access token for one connection, refreshing first if it is close to
 * expiry. The ONLY place a stored token is decrypted.
 *
 * A refresh that fails with 400/401 is treated as terminal (`revoked`), not
 * retried: providers reject a refresh token permanently once consent is removed,
 * so retrying converts one revocation into a failure per recipient with no
 * signal telling the user to reconnect. Any other failure stays `connected` so a
 * transient provider outage does not disconnect a healthy mailbox.
 */
export async function freshMailboxToken(
  db: Db,
  env: Env,
  tenantId: number,
  connectionId: number,
): Promise<TokenResult> {
  const [row] = await db
    .select()
    .from(mailboxConnections)
    .where(and(eq(mailboxConnections.id, connectionId), eq(mailboxConnections.tenantId, tenantId)))
    .limit(1);
  if (!row) return { ok: false, status: 'unavailable', error: 'Mailbox connection not found.' };
  if (row.status === 'revoked') {
    return { ok: false, status: 'revoked', error: 'This mailbox needs to be reconnected.' };
  }

  const provider = getMailboxProvider(row.provider);
  if (!provider) return { ok: false, status: 'unavailable', error: `Unknown mailbox provider "${row.provider}".` };

  const rec = env as unknown as Record<string, string | undefined>;
  const clientId = rec[provider.clientIdKey];
  const clientSecret = rec[provider.clientSecretKey];
  if (!clientId || !clientSecret) {
    return { ok: false, status: 'unavailable', error: `${provider.label} is not configured on this deployment.` };
  }

  const tokens = await unsealOAuthTokens(env, tenantId, row.tokenEnc, row.tokenIv);
  if (!tokens) {
    return { ok: false, status: 'unavailable', error: 'Stored mailbox credentials could not be decrypted.' };
  }

  if (!oauthTokensStale(tokens)) {
    return { ok: true, accessToken: tokens.accessToken, provider, accountEmail: row.accountEmail };
  }
  if (!tokens.refreshToken) {
    await markRevoked(db, tenantId, connectionId, 'No refresh token stored — reconnect this mailbox.');
    return { ok: false, status: 'revoked', error: 'No refresh token stored — reconnect this mailbox.' };
  }

  try {
    const refreshed = await refreshAccessToken(
      { tokenUrl: provider.tokenUrl, clientId, clientSecret },
      tokens.refreshToken,
    );
    const next = mergeRefreshedTokens(tokens, refreshed);
    const sealed = await sealOAuthTokens(env, tenantId, next);
    await db
      .update(mailboxConnections)
      .set({
        tokenEnc: sealed.enc,
        tokenIv: sealed.iv,
        expiresAt: next.expiresAtMs ? new Date(next.expiresAtMs) : null,
        status: 'connected',
        lastError: null,
        updatedAt: sql`NOW()`,
      })
      .where(and(eq(mailboxConnections.id, connectionId), eq(mailboxConnections.tenantId, tenantId)));
    return { ok: true, accessToken: refreshed.access_token, provider, accountEmail: row.accountEmail };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Token refresh failed';
    if (isTerminalRefreshFailure(message)) {
      await markRevoked(db, tenantId, connectionId, message);
      return { ok: false, status: 'revoked', error: 'This mailbox needs to be reconnected.' };
    }
    await db
      .update(mailboxConnections)
      .set({ lastError: message.slice(0, 1_000), updatedAt: sql`NOW()` })
      .where(and(eq(mailboxConnections.id, connectionId), eq(mailboxConnections.tenantId, tenantId)));
    reportCaughtError(error, { source: 'application/mailbox/mailboxService.ts', operation: 'freshMailboxToken' });
    return { ok: false, status: 'expired', error: message };
  }
}

async function markRevoked(db: Db, tenantId: number, connectionId: number, error: string): Promise<void> {
  await db
    .update(mailboxConnections)
    .set({ status: 'revoked', lastError: error.slice(0, 1_000), updatedAt: sql`NOW()` })
    .where(and(eq(mailboxConnections.id, connectionId), eq(mailboxConnections.tenantId, tenantId)));
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export type MailboxReadResult =
  | { ok: true; messages: MailboxMessage[]; accountEmail: string; provider: MailboxProviderName }
  | { ok: false; status: 400 | 404 | 409 | 502; error: string };

/**
 * Read a connected mailbox.
 *
 * `lastSyncedAt` is stamped on success so the UI can say when the tile it is
 * showing was actually true — an inbox tile with no freshness marker is a
 * screenshot pretending to be live.
 */
export async function readMailbox(
  db: Db,
  env: Env,
  tenantId: number,
  connectionId: number,
  query: MailboxQuery,
): Promise<MailboxReadResult> {
  const token = await freshMailboxToken(db, env, tenantId, connectionId);
  if (!token.ok) {
    return { ok: false, status: token.status === 'unavailable' ? 404 : 409, error: token.error };
  }
  try {
    const messages = await token.provider.listMessages(token.accessToken, {
      ...query,
      limit: clampMailboxLimit(query.limit),
    });
    await db
      .update(mailboxConnections)
      .set({ lastSyncedAt: sql`NOW()`, lastError: null })
      .where(and(eq(mailboxConnections.id, connectionId), eq(mailboxConnections.tenantId, tenantId)));
    return { ok: true, messages, accountEmail: token.accountEmail, provider: token.provider.name };
  } catch (error) {
    return failedRead(db, tenantId, connectionId, error);
  }
}

export type MailboxMessageResult =
  | { ok: true; message: MailboxMessage }
  | { ok: false; status: 404 | 409 | 502; error: string };

export async function readMailboxMessage(
  db: Db,
  env: Env,
  tenantId: number,
  connectionId: number,
  messageId: string,
): Promise<MailboxMessageResult> {
  const token = await freshMailboxToken(db, env, tenantId, connectionId);
  if (!token.ok) {
    return { ok: false, status: token.status === 'unavailable' ? 404 : 409, error: token.error };
  }
  try {
    const message = await token.provider.getMessage(token.accessToken, messageId);
    if (!message) return { ok: false, status: 404, error: 'Message not found in this mailbox.' };
    return { ok: true, message };
  } catch (error) {
    const failed = await failedRead(db, tenantId, connectionId, error);
    return failed as { ok: false; status: 404 | 409 | 502; error: string };
  }
}

/** Shared failure handling: a 401/403 from the provider AFTER a successful
 *  refresh means consent was withdrawn between the two calls, so the row is
 *  revoked here too rather than looking healthy while failing every read. */
async function failedRead(
  db: Db,
  tenantId: number,
  connectionId: number,
  error: unknown,
): Promise<{ ok: false; status: 409 | 502; error: string }> {
  const message = error instanceof Error ? error.message : 'Mailbox read failed';
  const status = error instanceof MailboxProviderError ? error.status : 0;
  if (status === 401 || status === 403) {
    await markRevoked(db, tenantId, connectionId, message);
    return { ok: false, status: 409, error: 'This mailbox needs to be reconnected.' };
  }
  await db
    .update(mailboxConnections)
    .set({ lastError: message.slice(0, 1_000), updatedAt: sql`NOW()` })
    .where(and(eq(mailboxConnections.id, connectionId), eq(mailboxConnections.tenantId, tenantId)));
  reportCaughtError(error, { source: 'application/mailbox/mailboxService.ts', operation: 'readMailbox' });
  return { ok: false, status: 502, error: message };
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export type MailboxSendResult =
  | { ok: true; id: string; accountEmail: string }
  | { ok: false; status: 404 | 409 | 502; error: string; retryable: boolean };

/**
 * Send one message from a connected mailbox.
 *
 * `retryable` is the contract with the campaign engine: a revoked grant must
 * stop the whole campaign (every subsequent recipient would fail identically),
 * whereas a transient provider error should fail just that recipient and leave
 * the rest of the batch to run.
 */
export async function sendFromMailbox(
  db: Db,
  env: Env,
  tenantId: number,
  connectionId: number,
  message: OutgoingMessage,
): Promise<MailboxSendResult> {
  const token = await freshMailboxToken(db, env, tenantId, connectionId);
  if (!token.ok) {
    return {
      ok: false,
      status: token.status === 'unavailable' ? 404 : 409,
      error: token.error,
      retryable: token.status === 'expired',
    };
  }
  try {
    const sent = await token.provider.sendMessage(token.accessToken, message);
    return { ok: true, id: sent.id, accountEmail: token.accountEmail };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Mailbox send failed';
    const status = error instanceof MailboxProviderError ? error.status : 0;
    if (status === 401 || status === 403) {
      await markRevoked(db, tenantId, connectionId, detail);
      return { ok: false, status: 409, error: 'This mailbox needs to be reconnected.', retryable: false };
    }
    reportCaughtError(error, { source: 'application/mailbox/mailboxService.ts', operation: 'sendFromMailbox' });
    // 429 and 5xx are the provider asking us to come back later.
    return { ok: false, status: 502, error: detail, retryable: status === 429 || status >= 500 };
  }
}

/** Update read/unread state in the provider; no local shadow can drift. */
export async function setMailboxMessageRead(
  db: Db, env: Env, tenantId: number, connectionId: number, messageId: string, read: boolean,
): Promise<{ ok: true } | { ok: false; status: 404 | 409 | 502 | 503; error: string }> {
  const token = await freshMailboxToken(db, env, tenantId, connectionId);
  if (!token.ok) return { ok: false, status: token.status === 'revoked' ? 409 : 503, error: token.error };
  try {
    await token.provider.setRead(token.accessToken, messageId, read);
    return { ok: true };
  } catch (error) {
    if (error instanceof MailboxProviderError) return { ok: false, status: error.status === 404 ? 404 : 502, error: error.message };
    reportCaughtError(error, { source: 'application/mailbox/mailboxService.ts', operation: 'setMailboxMessageRead' });
    return { ok: false, status: 503, error: 'The mailbox provider could not update this message.' };
  }
}

// ---------------------------------------------------------------------------
// Triage — "evaluate these emails"
// ---------------------------------------------------------------------------

/**
 * The compact projection handed to a model when it is asked to evaluate an inbox.
 *
 * Bodies are truncated hard: the Brain re-sends its whole transcript every turn,
 * and 25 full marketing emails is tens of thousands of tokens that push the real
 * conversation out of the window. A model that needs one message in full asks for
 * it by id via `mailbox.get_message`.
 */
export const TRIAGE_BODY_CHARS = 600;

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

export function toTriageMessages(messages: MailboxMessage[]): TriageMessage[] {
  return messages.map((m) => ({
    id: m.id,
    from: m.from,
    fromName: m.fromName,
    subject: m.subject,
    receivedAtISO: m.receivedAtISO,
    unread: m.unread,
    hasAttachments: m.hasAttachments,
    excerpt: (m.bodyText || m.snippet).slice(0, TRIAGE_BODY_CHARS),
  }));
}

/**
 * Resolve which mailbox a caller meant.
 *
 * Callers routinely name a mailbox by ADDRESS ("send it from hello@acme.com")
 * rather than by id, and an agent has no id to hand. Falling back to the single
 * sendable mailbox when there is exactly one is what makes "send from my mailbox"
 * work without a disambiguation round-trip; two mailboxes and no name is an
 * ambiguity the caller has to resolve, not one to guess at.
 */
export async function resolveMailbox(
  db: Db,
  tenantId: number,
  ref: { connectionId?: number | null; accountEmail?: string | null },
  opts: { forSending?: boolean } = {},
): Promise<{ ok: true; connection: MailboxConnectionView } | { ok: false; error: string }> {
  const all = await listMailboxConnections(db, tenantId);
  const usable = opts.forSending
    ? all.filter((c) => c.allowSending && c.status === 'connected')
    : all.filter((c) => c.status !== 'revoked');

  if (ref.connectionId != null) {
    const match = all.find((c) => c.id === ref.connectionId);
    if (!match) return { ok: false, error: 'That mailbox is not connected to this workspace.' };
    if (opts.forSending && !match.allowSending) {
      return { ok: false, error: `Sending is turned off for ${match.accountEmail}.` };
    }
    return { ok: true, connection: match };
  }

  const email = ref.accountEmail?.trim().toLowerCase();
  if (email) {
    const match = usable.find((c) => c.accountEmail === email);
    if (!match) return { ok: false, error: `No connected mailbox for ${email}.` };
    return { ok: true, connection: match };
  }

  if (usable.length === 1) return { ok: true, connection: usable[0]! };
  if (usable.length === 0) {
    return {
      ok: false,
      error: opts.forSending
        ? 'No mailbox is connected and enabled for sending. Connect one in Growth → Mailboxes.'
        : 'No mailbox is connected. Connect one in Growth → Mailboxes.',
    };
  }
  return {
    ok: false,
    error: `Several mailboxes are connected (${usable.map((c) => c.accountEmail).join(', ')}). Name which one to use.`,
  };
}
