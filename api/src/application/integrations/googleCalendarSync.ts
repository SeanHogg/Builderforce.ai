/**
 * Google Calendar → member-profile sync. Overlays a member's real availability
 * (busy now? upcoming PTO/out-of-office) from their Google Calendar onto
 * member_profiles, flipping sync_source to 'google_calendar'. This is the
 * "Calendar later" seam designed into migration 0116 — manual profiles still work;
 * a tenant that connects a Google account (an integration_credentials row, the
 * same framework GitHub/Jira use) can keep availability fresh automatically.
 *
 * The HTTP calls are thin; the mapping (busy → availability, events → PTO) is pure
 * and unit-tested. The integration is operator-gated: it does nothing until the
 * tenant connects a Google account with calendar read scope.
 */
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { memberProfiles } from '../../infrastructure/database/schema';

export interface BusyBlock { start: string; end: string; }
export interface CalEvent { summary?: string; eventType?: string; start?: { date?: string; dateTime?: string }; end?: { date?: string; dateTime?: string }; }
export interface PtoBlock { from: string; to: string; reason: string; }

const PTO_RX = /\b(ooo|out of office|vacation|pto|holiday|annual leave|on leave|sick)\b/i;

/** Busy-now → availability. If `now` falls inside a busy block, the member is
 *  busy until that block ends; otherwise available. Pure. */
export function deriveAvailability(now: Date, busy: BusyBlock[]): { availabilityStatus: 'available' | 'busy'; availabilityUntil: string | null } {
  const t = now.getTime();
  const current = busy
    .map((b) => ({ start: new Date(b.start).getTime(), end: new Date(b.end).getTime() }))
    .filter((b) => b.start <= t && t < b.end)
    .sort((a, b) => b.end - a.end)[0];
  return current
    ? { availabilityStatus: 'busy', availabilityUntil: new Date(current.end).toISOString() }
    : { availabilityStatus: 'available', availabilityUntil: null };
}

/** Out-of-office / all-day PTO events → pto blocks. Uses Google's `outOfOffice`
 *  eventType when present, else an all-day event whose title reads like leave. Pure. */
export function derivePto(events: CalEvent[]): PtoBlock[] {
  const out: PtoBlock[] = [];
  for (const e of events) {
    const allDay = !!e.start?.date && !!e.end?.date;
    const isOoo = e.eventType === 'outOfOffice' || (allDay && PTO_RX.test(e.summary ?? ''));
    if (!isOoo) continue;
    const from = e.start?.date ?? e.start?.dateTime;
    const to = e.end?.date ?? e.end?.dateTime;
    if (from && to) out.push({ from, to, reason: e.summary || 'Out of office' });
  }
  return out;
}

interface OAuthEnv { GOOGLE_OAUTH_CLIENT_ID?: string; GOOGLE_OAUTH_CLIENT_SECRET?: string }

/** Refresh an expired access token if a refresh token + OAuth client are
 *  configured. Returns the new access token, or null when refresh isn't possible. */
async function refreshAccessToken(env: Env, refreshToken: string): Promise<string | null> {
  const e = env as unknown as OAuthEnv;
  if (!e.GOOGLE_OAUTH_CLIENT_ID || !e.GOOGLE_OAUTH_CLIENT_SECRET) return null;
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: e.GOOGLE_OAUTH_CLIENT_ID,
        client_secret: e.GOOGLE_OAUTH_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { access_token?: string };
    return json.access_token ?? null;
  } catch {
    return null;
  }
}

export interface CalendarCredential { accessToken?: string; refreshToken?: string }

export interface SyncResult {
  ok: boolean;
  message?: string;
  availabilityStatus?: 'available' | 'busy';
  availabilityUntil?: string | null;
  ptoCount?: number;
}

/**
 * Pull a member's Google Calendar over the next `days` and write the derived
 * availability + PTO onto their member_profile. Humans only (agents have no
 * calendar). The credential's token is refreshed once on a 401 when possible.
 */
export async function syncMemberCalendar(
  env: Env,
  db: Db,
  input: { tenantId: number; memberRef: string; calendarId: string; credential: CalendarCredential; days?: number },
): Promise<SyncResult> {
  let token = input.credential.accessToken;
  if (!token) return { ok: false, message: 'credential has no access token' };

  const now = new Date();
  const timeMin = now.toISOString();
  const timeMax = new Date(now.getTime() + (input.days ?? 14) * 86_400_000).toISOString();
  const cal = encodeURIComponent(input.calendarId);

  const call = async (tok: string) => {
    const freeBusy = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ timeMin, timeMax, items: [{ id: input.calendarId }] }),
    });
    const events = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${cal}/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&maxResults=50`,
      { headers: { Authorization: `Bearer ${tok}` } },
    );
    return { freeBusy, events };
  };

  let { freeBusy, events } = await call(token);
  if ((freeBusy.status === 401 || events.status === 401) && input.credential.refreshToken) {
    const fresh = await refreshAccessToken(env, input.credential.refreshToken);
    if (fresh) { token = fresh; ({ freeBusy, events } = await call(fresh)); }
  }
  if (!freeBusy.ok) return { ok: false, message: `freeBusy failed (${freeBusy.status})` };

  const fbJson = (await freeBusy.json()) as { calendars?: Record<string, { busy?: BusyBlock[] }> };
  const busy = fbJson.calendars?.[input.calendarId]?.busy ?? [];
  const evJson = events.ok ? ((await events.json()) as { items?: CalEvent[] }) : { items: [] };

  const avail = deriveAvailability(now, busy);
  const pto = derivePto(evJson.items ?? []);

  const values = {
    tenantId: input.tenantId,
    memberKind: 'human' as const,
    memberRef: input.memberRef,
    availabilityStatus: avail.availabilityStatus,
    availabilityUntil: avail.availabilityUntil ? new Date(avail.availabilityUntil) : null,
    pto,
    syncSource: 'google_calendar' as const,
    lastActiveAt: now,
    updatedAt: now,
  };
  await db
    .insert(memberProfiles)
    .values(values)
    .onConflictDoUpdate({
      target: [memberProfiles.tenantId, memberProfiles.memberKind, memberProfiles.memberRef],
      set: {
        availabilityStatus: values.availabilityStatus,
        availabilityUntil: values.availabilityUntil,
        pto: values.pto,
        syncSource: values.syncSource,
        lastActiveAt: values.lastActiveAt,
        updatedAt: values.updatedAt,
      },
    });

  return { ok: true, availabilityStatus: avail.availabilityStatus, availabilityUntil: avail.availabilityUntil, ptoCount: pto.length };
}
