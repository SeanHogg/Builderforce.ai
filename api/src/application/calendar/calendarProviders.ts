/**
 * Calendar provider adapters — Google Calendar (v3) and Microsoft Graph. Each
 * provider knows its OAuth endpoints/scopes and how to create / list / delete
 * events, normalized to a common shape so {@link ../../presentation/routes/calendarRoutes}
 * and the meeting scheduler stay provider-agnostic.
 */
import type { Env } from '../../env';

export type CalendarProviderName = 'google' | 'microsoft';

/** A normalized upcoming-event row surfaced to the UI. */
export interface CalendarEvent {
  id: string;
  title: string;
  /** ISO 8601 start/end (UTC). */
  startISO: string;
  endISO: string;
  htmlLink?: string;
  location?: string;
  organizer?: string;
}

/** The data needed to create a calendar event for a meeting. */
export interface CalendarEventInput {
  title: string;
  description?: string;
  startISO: string;
  endISO: string;
  /** Attendee emails to invite. */
  attendeeEmails?: string[];
  /** The in-app join URL (surfaced in the event body/location). */
  joinUrl?: string;
}

export interface CalendarProvider {
  name: CalendarProviderName;
  authUrl: string;
  tokenUrl: string;
  scopes: string[];
  extraAuthParams?: Record<string, string>;
  clientIdKey: keyof Env;
  clientSecretKey: keyof Env;
  /** Endpoint + parser to resolve the connected account's email. */
  accountInfoUrl: string;
  parseAccountEmail: (d: Record<string, unknown>) => string;
  createEvent: (accessToken: string, calendarId: string, input: CalendarEventInput) => Promise<{ id: string; htmlLink?: string }>;
  listUpcoming: (accessToken: string, calendarId: string, opts: { maxResults: number; timeMinISO: string; timeMaxISO: string }) => Promise<CalendarEvent[]>;
  deleteEvent: (accessToken: string, calendarId: string, eventId: string) => Promise<void>;
}

async function jsonFetch(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`Calendar API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.status === 204 ? {} : (res.json() as Promise<Record<string, unknown>>);
}

// ── Google Calendar v3 ──────────────────────────────────────────────────────
const google: CalendarProvider = {
  name: 'google',
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  scopes: [
    'openid', 'email', 'profile',
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/calendar.readonly',
  ],
  // access_type=offline + prompt=consent guarantees a refresh_token on connect.
  extraAuthParams: { access_type: 'offline', prompt: 'consent' },
  clientIdKey: 'GOOGLE_CLIENT_ID',
  clientSecretKey: 'GOOGLE_CLIENT_SECRET',
  accountInfoUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
  parseAccountEmail: (d) => String(d.email ?? ''),

  async createEvent(accessToken, calendarId, input) {
    const body = {
      summary: input.title,
      description: [input.description, input.joinUrl ? `Join: ${input.joinUrl}` : '']
        .filter(Boolean).join('\n\n'),
      location: input.joinUrl,
      start: { dateTime: input.startISO },
      end: { dateTime: input.endISO },
      attendees: (input.attendeeEmails ?? []).map((email) => ({ email })),
    };
    const d = await jsonFetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=all`,
      { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    );
    return { id: String(d.id ?? ''), htmlLink: d.htmlLink ? String(d.htmlLink) : undefined };
  },

  async listUpcoming(accessToken, calendarId, opts) {
    const qs = new URLSearchParams({
      timeMin: opts.timeMinISO,
      timeMax: opts.timeMaxISO,
      maxResults: String(opts.maxResults),
      singleEvents: 'true',
      orderBy: 'startTime',
    });
    const d = await jsonFetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${qs}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const items = Array.isArray(d.items) ? (d.items as Record<string, unknown>[]) : [];
    return items.map((e) => {
      const start = e.start as Record<string, unknown> | undefined;
      const end = e.end as Record<string, unknown> | undefined;
      const org = e.organizer as Record<string, unknown> | undefined;
      return {
        id: String(e.id ?? ''),
        title: String(e.summary ?? '(no title)'),
        startISO: String(start?.dateTime ?? start?.date ?? ''),
        endISO: String(end?.dateTime ?? end?.date ?? ''),
        htmlLink: e.htmlLink ? String(e.htmlLink) : undefined,
        location: e.location ? String(e.location) : undefined,
        organizer: org?.email ? String(org.email) : undefined,
      };
    });
  },

  async deleteEvent(accessToken, calendarId, eventId) {
    await jsonFetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } },
    );
  },
};

// ── Microsoft Graph ─────────────────────────────────────────────────────────
const microsoft: CalendarProvider = {
  name: 'microsoft',
  authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
  tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
  scopes: ['openid', 'email', 'profile', 'offline_access', 'User.Read', 'Calendars.ReadWrite'],
  clientIdKey: 'MICROSOFT_CLIENT_ID',
  clientSecretKey: 'MICROSOFT_CLIENT_SECRET',
  accountInfoUrl: 'https://graph.microsoft.com/v1.0/me',
  parseAccountEmail: (d) => String(d.mail ?? d.userPrincipalName ?? ''),

  async createEvent(accessToken, _calendarId, input) {
    const body = {
      subject: input.title,
      body: { contentType: 'HTML', content: [input.description, input.joinUrl ? `Join: <a href="${input.joinUrl}">${input.joinUrl}</a>` : ''].filter(Boolean).join('<br><br>') },
      location: input.joinUrl ? { displayName: input.joinUrl } : undefined,
      start: { dateTime: input.startISO, timeZone: 'UTC' },
      end: { dateTime: input.endISO, timeZone: 'UTC' },
      attendees: (input.attendeeEmails ?? []).map((email) => ({ emailAddress: { address: email }, type: 'required' })),
    };
    const d = await jsonFetch('https://graph.microsoft.com/v1.0/me/events', {
      method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { id: String(d.id ?? ''), htmlLink: d.webLink ? String(d.webLink) : undefined };
  },

  async listUpcoming(accessToken, _calendarId, opts) {
    const qs = new URLSearchParams({
      startDateTime: opts.timeMinISO,
      endDateTime: opts.timeMaxISO,
      $orderby: 'start/dateTime',
      $top: String(opts.maxResults),
    });
    const d = await jsonFetch(`https://graph.microsoft.com/v1.0/me/calendarView?${qs}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Prefer: 'outlook.timezone="UTC"' },
    });
    const items = Array.isArray(d.value) ? (d.value as Record<string, unknown>[]) : [];
    return items.map((e) => {
      const start = e.start as Record<string, unknown> | undefined;
      const end = e.end as Record<string, unknown> | undefined;
      const loc = e.location as Record<string, unknown> | undefined;
      const org = e.organizer as Record<string, unknown> | undefined;
      const orgAddr = (org?.emailAddress as Record<string, unknown> | undefined)?.address;
      // Graph returns local-naive dateTimes; append Z since we requested UTC.
      const toIso = (v: unknown) => { const s = String(v ?? ''); return s && !/[Z+]/.test(s) ? `${s}Z` : s; };
      return {
        id: String(e.id ?? ''),
        title: String(e.subject ?? '(no title)'),
        startISO: toIso(start?.dateTime),
        endISO: toIso(end?.dateTime),
        htmlLink: e.webLink ? String(e.webLink) : undefined,
        location: loc?.displayName ? String(loc.displayName) : undefined,
        organizer: orgAddr ? String(orgAddr) : undefined,
      };
    });
  },

  async deleteEvent(accessToken, _calendarId, eventId) {
    await jsonFetch(`https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(eventId)}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` },
    });
  },
};

const PROVIDERS: Record<CalendarProviderName, CalendarProvider> = { google, microsoft };

export function getCalendarProvider(name: string): CalendarProvider | null {
  return PROVIDERS[name as CalendarProviderName] ?? null;
}

/** Providers whose OAuth client credentials are configured on this environment. */
export function availableCalendarProviders(env: Env): CalendarProviderName[] {
  const rec = env as unknown as Record<string, string | undefined>;
  return (Object.keys(PROVIDERS) as CalendarProviderName[]).filter((n) => {
    const p = PROVIDERS[n];
    return !!rec[p.clientIdKey as string] && !!rec[p.clientSecretKey as string];
  });
}
