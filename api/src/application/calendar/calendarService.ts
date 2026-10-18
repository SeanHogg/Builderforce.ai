import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * Calendar service — token lifecycle + meeting⇆event sync on top of the provider
 * adapters. Keeps token refresh in ONE place so both the calendar routes (list
 * upcoming) and the meeting scheduler (push an event on create, delete on cancel)
 * share it.
 */
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { calendarConnections } from '../../infrastructure/database/schema';
import {
  mergeRefreshedTokens,
  providerGrantRefresher,
  refreshGrantIfStale,
  sealOAuthTokens,
  unsealOAuthTokens,
  type RefreshedTokens,
  type SealedOAuthTokens,
} from '../integrations/oauthTokenVault';
import { getCalendarProvider, type CalendarProviderName, type CalendarEventInput } from './calendarProviders';

type Connection = typeof calendarConnections.$inferSelect;

/**
 * The grant behind a row — always the sealed blob.
 *
 * Null means "cannot be read" — a sealed blob that will not open, or a row with
 * no blob. Treated as a grant that must be reconnected, never as an empty
 * token that would 401 on every call.
 */
async function readGrant(env: Env, conn: Connection): Promise<SealedOAuthTokens | null> {
  if (conn.tokenEnc && conn.tokenIv) {
    return unsealOAuthTokens(env, conn.tenantId, conn.tokenEnc, conn.tokenIv);
  }
  return null;
}

/**
 * Seal a grant onto its row. Tokens live only in `token_enc` / `token_iv`.
 */
export async function persistGrant(
  db: Db,
  env: Env,
  conn: Pick<Connection, 'id' | 'tenantId'>,
  tokens: SealedOAuthTokens,
): Promise<void> {
  const sealed = await sealOAuthTokens(env, conn.tenantId, tokens);
  await db.update(calendarConnections)
    .set({
      tokenEnc: sealed.enc,
      tokenIv: sealed.iv,
      expiresAt: tokens.expiresAtMs ? new Date(tokens.expiresAtMs) : null,
      scope: tokens.scope ?? null,
      updatedAt: new Date(),
    })
    .where(eq(calendarConnections.id, conn.id));
}

/**
 * Return a connection with a guaranteed-fresh access token, refreshing +
 * persisting when it is stale. Returns null if it cannot be refreshed (revoked /
 * unconfigured / transient failure).
 */
export async function freshAccessToken(db: Db, env: Env, conn: Connection): Promise<string | null> {
  const grant = await readGrant(env, conn);
  if (!grant) return null;

  // The shared lifecycle carries the refresh margin and the merge rule, so a
  // calendar grant and a Drive grant answer "is this token good enough for the
  // tail of a batch" the same way.
  const provider = getCalendarProvider(conn.provider as CalendarProviderName);
  const refresh = await refreshGrantIfStale(grant, provider ? providerGrantRefresher(env, provider) : null);
  if (!refresh.ok) {
    // Best-effort: with no refresh token the stored access token may still be valid.
    return refresh.reason === 'no_refresh_token' ? grant.accessToken : null;
  }
  if (!refresh.refreshed) return refresh.tokens.accessToken;
  try {
    await persistGrant(db, env, conn, refresh.tokens);
    return refresh.tokens.accessToken;
  } catch {
    return null;
  }
}

/**
 * Record the grant a provider handed back at the end of the OAuth dance.
 *
 * Lives here rather than in the route because it is token mechanics: sealing, and
 * the one rule that is easy to get wrong — GOOGLE OMITS `refresh_token` ON
 * RE-CONSENT unless `prompt=consent` was sent, and expects the previously issued
 * one to be kept. The row before this call is therefore read first and the old
 * refresh token carried forward, which `mergeRefreshedTokens` already encodes for
 * the refresh path. Sealing a blob without it would leave a grant that works until
 * the access token expires and then silently becomes unrefreshable.
 *
 * Writes sealed. There is no plaintext column to clear.
 */
export async function upsertCalendarGrant(
  db: Db,
  env: Env,
  input: {
    tenantId: number;
    userId: string;
    provider: CalendarProviderName;
    accountEmail: string | null;
    tokens: RefreshedTokens;
    defaultScope: string;
  },
): Promise<void> {
  const existing = await getUserConnection(db, input.tenantId, input.userId, input.provider);
  const previous = existing ? await readGrant(env, existing) : null;

  const merged = mergeRefreshedTokens(
    previous ?? { accessToken: '' },
    { ...input.tokens, scope: input.tokens.scope ?? input.defaultScope },
  );
  const sealed = await sealOAuthTokens(env, input.tenantId, merged);
  const expiresAt = merged.expiresAtMs ? new Date(merged.expiresAtMs) : null;

  await db.insert(calendarConnections).values({
    tenantId: input.tenantId,
    userId: input.userId,
    provider: input.provider,
    accountEmail: input.accountEmail,
    tokenEnc: sealed.enc,
    tokenIv: sealed.iv,
    expiresAt,
    scope: merged.scope ?? null,
  }).onConflictDoUpdate({
    target: [calendarConnections.userId, calendarConnections.provider],
    set: {
      tokenEnc: sealed.enc,
      tokenIv: sealed.iv,
      accountEmail: input.accountEmail,
      expiresAt,
      scope: merged.scope ?? null,
      tenantId: input.tenantId,
      updatedAt: new Date(),
    },
  });
}

/** The user's connection for a provider (or their first connection if unspecified). */
export async function getUserConnection(
  db: Db,
  tenantId: number,
  userId: string,
  provider?: CalendarProviderName,
): Promise<Connection | null> {
  const rows = await db.select().from(calendarConnections).where(and(
    eq(calendarConnections.tenantId, tenantId),
    eq(calendarConnections.userId, userId),
    ...(provider ? [eq(calendarConnections.provider, provider)] : []),
  ));
  return rows[0] ?? null;
}

/**
 * Push a meeting onto the organizer's calendar. No-op (returns null) when the
 * organizer has no connection — meetings work fully without a calendar; the
 * calendar event is an enhancement.
 */
export async function pushMeetingEvent(
  db: Db,
  env: Env,
  tenantId: number,
  organizerId: string,
  input: CalendarEventInput,
): Promise<{ provider: CalendarProviderName; eventId: string; htmlLink?: string } | null> {
  const conn = await getUserConnection(db, tenantId, organizerId);
  if (!conn) return null;
  const provider = getCalendarProvider(conn.provider);
  if (!provider) return null;
  const token = await freshAccessToken(db, env, conn);
  if (!token) return null;
  try {
    const { id, htmlLink } = await provider.createEvent(token, conn.calendarId, input);
    return { provider: conn.provider as CalendarProviderName, eventId: id, htmlLink };
  } catch {
    return null; // never fail the meeting create because the calendar push failed
  }
}

/** Best-effort delete of the calendar event mirroring a cancelled meeting. */
export async function deleteMeetingEvent(
  db: Db,
  env: Env,
  tenantId: number,
  organizerId: string,
  provider: CalendarProviderName,
  eventId: string,
): Promise<void> {
  const conn = await getUserConnection(db, tenantId, organizerId, provider);
  if (!conn) return;
  const p = getCalendarProvider(provider);
  if (!p) return;
  const token = await freshAccessToken(db, env, conn);
  if (!token) return;
  try { await p.deleteEvent(token, conn.calendarId, eventId); } catch (error) { /* best effort */ 
    reportCaughtError(error, { source: "application/calendar/calendarService.ts", operation: "deleteMeetingEvent" });
  }
}
