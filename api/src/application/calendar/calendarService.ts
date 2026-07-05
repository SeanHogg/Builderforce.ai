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
import { getCalendarProvider, type CalendarProviderName, type CalendarEventInput } from './calendarProviders';

type Connection = typeof calendarConnections.$inferSelect;

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
  const notExpired = conn.expiresAt && conn.expiresAt.getTime() - Date.now() > 60_000;
  if (notExpired) return conn.accessToken;
  if (!conn.refreshToken) return conn.accessToken; // best-effort; may already be valid
  const creds = providerCreds(env, conn.provider as CalendarProviderName);
  if (!creds) return null;
  try {
    const tok = await refreshAccessToken(
      { tokenUrl: creds.provider.tokenUrl, clientId: creds.clientId, clientSecret: creds.clientSecret },
      conn.refreshToken,
    );
    const expiresAt = tok.expires_in ? new Date(Date.now() + tok.expires_in * 1000) : null;
    await db.update(calendarConnections)
      .set({
        accessToken: tok.access_token,
        refreshToken: tok.refresh_token ?? conn.refreshToken,
        expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(calendarConnections.id, conn.id));
    return tok.access_token;
  } catch {
    return null;
  }
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
  try { await p.deleteEvent(token, conn.calendarId, eventId); } catch { /* best effort */ }
}
