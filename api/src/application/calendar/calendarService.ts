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
import { refreshAccessToken } from '../../infrastructure/auth/oauthState';
import {
  mergeRefreshedTokens,
  oauthTokensStale,
  sealOAuthTokens,
  unsealOAuthTokens,
  type RefreshedTokens,
  type SealedOAuthTokens,
} from '../integrations/oauthTokenVault';
import { getCalendarProvider, type CalendarProviderName, type CalendarEventInput } from './calendarProviders';

type Connection = typeof calendarConnections.$inferSelect;

/**
 * The grant behind a row, whichever way it is stored.
 *
 * Migration 1107 moved calendar grants into the sealed vault every other per-user
 * connection already used. It is a ROLLING migration: a row written before it
 * still carries the plaintext `access_token` / `refresh_token`, so this prefers
 * the sealed blob and falls back to the legacy columns. Returning them through one
 * shape means the callers below never learn which era a row is from — the only
 * place that knows is {@link persistGrant}, which always writes sealed.
 *
 * Null means "cannot be read" — a sealed blob that will not open, or a row with
 * neither form. Treated as a grant that must be reconnected, never as an empty
 * token that would 401 on every call.
 */
async function readGrant(env: Env, conn: Connection): Promise<SealedOAuthTokens | null> {
  if (conn.tokenEnc && conn.tokenIv) {
    return unsealOAuthTokens(env, conn.tenantId, conn.tokenEnc, conn.tokenIv);
  }
  if (!conn.accessToken) return null;
  return {
    accessToken: conn.accessToken,
    refreshToken: conn.refreshToken ?? undefined,
    expiresAtMs: conn.expiresAt ? conn.expiresAt.getTime() : undefined,
    scope: conn.scope ?? undefined,
  };
}

/**
 * Seal a grant onto its row, clearing the legacy plaintext in the same statement.
 *
 * Clearing is the point: a refresh that sealed the new token but left the old
 * plaintext behind would leave a working refresh token in the clear indefinitely,
 * which is the defect 1107 exists to close. Anything that touches a legacy row
 * therefore also finishes migrating it, so the backfill drains through ordinary
 * use rather than needing a sweep.
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
      accessToken: null,
      refreshToken: null,
      expiresAt: tokens.expiresAtMs ? new Date(tokens.expiresAtMs) : null,
      scope: tokens.scope ?? null,
      updatedAt: new Date(),
    })
    .where(eq(calendarConnections.id, conn.id));
}

function providerCreds(env: Env, provider: CalendarProviderName) {
  const p = getCalendarProvider(provider);
  if (!p) return null;
  const rec = env as unknown as Record<string, string | undefined>;
  const clientId = rec[p.clientIdKey as string];
  const clientSecret = rec[p.clientSecretKey as string];
  if (!clientId || !clientSecret) return null;
  return { provider: p, clientId, clientSecret };
}

/**
 * Return a connection with a guaranteed-fresh access token, refreshing +
 * persisting when it is within 60s of expiry. Returns null if it cannot be
 * refreshed (revoked / no refresh token).
 */
export async function freshAccessToken(db: Db, env: Env, conn: Connection): Promise<string | null> {
  const grant = await readGrant(env, conn);
  if (!grant) return null;

  // `oauthTokensStale` carries the shared refresh margin, so a calendar grant and
  // a Drive grant answer "is this token good enough for the tail of a batch" the
  // same way instead of with two hand-rolled expiry checks.
  if (!oauthTokensStale(grant)) {
    // A legacy row that is still valid is sealed here rather than on next refresh:
    // a long-lived grant could otherwise sit in plaintext for months.
    if (!conn.tokenEnc) await persistGrant(db, env, conn, grant);
    return grant.accessToken;
  }

  if (!grant.refreshToken) return grant.accessToken; // best-effort; may already be valid
  const creds = providerCreds(env, conn.provider as CalendarProviderName);
  if (!creds) return null;
  try {
    const tok = await refreshAccessToken(
      { tokenUrl: creds.provider.tokenUrl, clientId: creds.clientId, clientSecret: creds.clientSecret },
      grant.refreshToken,
    );
    const next = mergeRefreshedTokens(grant, tok);
    await persistGrant(db, env, conn, next);
    return next.accessToken;
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
 * Writes sealed and clears the legacy plaintext columns, so a re-consent also
 * finishes migrating a pre-1107 row.
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
      // Cleared, not left behind: a re-consent that sealed the new grant but kept
      // the old plaintext would leave a working refresh token in the clear.
      accessToken: null,
      refreshToken: null,
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
