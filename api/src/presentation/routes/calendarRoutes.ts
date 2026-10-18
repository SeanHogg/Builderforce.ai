import { reportCaughtError } from '../../application/observability/caughtErrorReporter';
/**
 * Calendar connections — /api/calendar/*
 *
 * Per-USER OAuth grants (Google Calendar / Microsoft Graph) used to schedule
 * meetings and surface upcoming events. The connect/callback dance itself is the
 * shared one ({@link ../../application/shared/providerOAuthConnect}, the same
 * primitive the mailbox and drive flows use); this file adds only the calendar
 * provider adapters ({@link ../../application/calendar/calendarProviders}) and
 * its own redirect vocabulary.
 *
 * Auth model: every endpoint is bearer-authed EXCEPT the OAuth `/callback/:provider`,
 * which is a top-level browser redirect FROM the provider (no bearer available) —
 * it is authenticated instead by the HMAC-signed `state` carrying the connecting
 * user + tenant.
 */
import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { authMiddleware } from '../middleware/authMiddleware';
import { calendarConnections } from '../../infrastructure/database/schema';
import { mountProviderOAuthConnect } from './providerOAuthConnectRoutes';
import {
  getCalendarProvider, availableCalendarProviders, type CalendarProvider, type CalendarProviderName, type CalendarEvent,
} from '../../application/calendar/calendarProviders';
import { freshAccessToken, upsertCalendarGrant } from '../../application/calendar/calendarService';
import { daysParam } from './queryParams';

/** Where the connect flow sends the browser back to when it is not told. */
const DEFAULT_RETURN_TO = '/meetings';

export function createCalendarRoutes(db: Db): Hono<HonoEnv> {
  const r = new Hono<HonoEnv>();

  // Bearer-auth everything except the provider redirect callback.
  r.use('*', async (c, next) => {
    if (c.req.path.includes('/callback/')) return next();
    return authMiddleware(c, next);
  });

  // GET /providers — which calendar providers are configured, + this user's connections.
  r.get('/providers', async (c) => {
    const env = c.env as Env;
    const userId = c.get('userId') as string;
    const tenantId = c.get('tenantId') as number;
    const conns = await db.select().from(calendarConnections)
      .where(and(eq(calendarConnections.tenantId, tenantId), eq(calendarConnections.userId, userId)));
    return c.json({
      providers: availableCalendarProviders(env),
      connections: conns.map((x) => ({ id: x.id, provider: x.provider, accountEmail: x.accountEmail, calendarId: x.calendarId })),
    });
  });

  // GET /connect/:provider + GET /callback/:provider — the shared connect pair;
  // only resolving the account email and storing the grant is the calendar's own.
  mountProviderOAuthConnect<CalendarProvider>(r, {
    callbackPath: (name) => `/api/calendar/callback/${name}`,
    outcomeParam: 'calendar',
    defaultReturnTo: DEFAULT_RETURN_TO,
    source: 'presentation/routes/calendarRoutes.ts',
    resolveConnect: (name) => {
      const provider = getCalendarProvider(name);
      return provider ? { provider, oauth: provider, label: `${name} calendar` } : { error: 'Unknown provider' };
    },
    onConnected: async (c, { provider, state, tokens }) => {
      // The account email is best-effort for a calendar (unlike a mailbox, it is
      // not the row's natural key), so a failed lookup still stores the grant.
      let accountEmail = '';
      try {
        const info = await fetch(provider.accountInfoUrl, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
        if (info.ok) accountEmail = provider.parseAccountEmail(await info.json() as Record<string, unknown>);
      } catch (error) {
        reportCaughtError(error, { source: 'presentation/routes/calendarRoutes.ts', operation: 'callback.accountInfo' });
      }

      await upsertCalendarGrant(db, c.env as Env, {
        tenantId: state.tenantId,
        userId: state.userId,
        // `provider.name` rather than the raw path param: the provider was already
        // resolved from it, so this is the validated value and it carries the type.
        provider: provider.name,
        accountEmail: accountEmail || null,
        tokens,
        defaultScope: provider.scopes.join(' '),
      });
      return 'connected';
    },
  });

  // DELETE /connections/:id — disconnect one of this user's calendars.
  r.delete('/connections/:id', async (c) => {
    const userId = c.get('userId') as string;
    const tenantId = c.get('tenantId') as number;
    await db.delete(calendarConnections).where(and(
      eq(calendarConnections.id, c.req.param('id')),
      eq(calendarConnections.tenantId, tenantId),
      eq(calendarConnections.userId, userId),
    ));
    return c.body(null, 204);
  });

  // GET /events?days=14 — merged upcoming events across this user's connections.
  r.get('/events', async (c) => {
    const env = c.env as Env;
    const userId = c.get('userId') as string;
    const tenantId = c.get('tenantId') as number;
    const days = daysParam(c.req.query('days'), 14, 60);
    const now = new Date();
    const timeMinISO = now.toISOString();
    const timeMaxISO = new Date(now.getTime() + days * 86_400_000).toISOString();

    const conns = await db.select().from(calendarConnections)
      .where(and(eq(calendarConnections.tenantId, tenantId), eq(calendarConnections.userId, userId)));

    const all: Array<CalendarEvent & { provider: CalendarProviderName }> = [];
    for (const conn of conns) {
      const provider = getCalendarProvider(conn.provider);
      if (!provider) continue;
      const token = await freshAccessToken(db, env, conn);
      if (!token) continue;
      try {
        const events = await provider.listUpcoming(token, conn.calendarId, { maxResults: 25, timeMinISO, timeMaxISO });
        for (const e of events) all.push({ ...e, provider: conn.provider as CalendarProviderName });
      } catch (error) { /* skip a failing provider, still return the rest */ 
        reportCaughtError(error, { source: "presentation/routes/calendarRoutes.ts", operation: "createCalendarRoutes" });
      }
    }
    all.sort((a, b) => a.startISO.localeCompare(b.startISO));
    return c.json({ events: all });
  });

  return r;
}
