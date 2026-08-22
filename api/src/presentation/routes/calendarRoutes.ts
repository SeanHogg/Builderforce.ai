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
import { resolveAppBaseUrl, type Env, type HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { authMiddleware } from '../middleware/authMiddleware';
import { calendarConnections } from '../../infrastructure/database/schema';
import {
  buildProviderConsentUrl,
  completeProviderOAuthCallback,
} from '../../application/shared/providerOAuthConnect';
import {
  getCalendarProvider, availableCalendarProviders, type CalendarProviderName, type CalendarEvent,
} from '../../application/calendar/calendarProviders';
import { freshAccessToken, upsertCalendarGrant } from '../../application/calendar/calendarService';

/** Where the connect flow sends the browser back to when it is not told. */
const DEFAULT_RETURN_TO = '/meetings';

export function createCalendarRoutes(db: Db): Hono<HonoEnv> {
  const r = new Hono<HonoEnv>();

  // Bearer-auth everything except the provider redirect callback.
  r.use('*', async (c, next) => {
    if (c.req.path.includes('/callback/')) return next();
    return authMiddleware(c, next);
  });

  const callbackUrl = (c: { req: { url: string } }, provider: string) =>
    `${new URL(c.req.url).origin}/api/calendar/callback/${provider}`;

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

  // GET /connect/:provider — build the provider consent URL (returned as JSON so
  // the client can `window.location = authUrl`; a top-nav GET can't carry Bearer).
  r.get('/connect/:provider', async (c) => {
    const env = c.env as Env;
    const name = c.req.param('provider');
    const provider = getCalendarProvider(name);
    if (!provider) return c.json({ error: 'Unknown provider' }, 400);

    const authUrl = await buildProviderConsentUrl(env, provider, {
      providerName: name,
      redirectUri: callbackUrl(c, name),
      userId: c.get('userId') as string,
      tenantId: c.get('tenantId') as number,
      returnTo: c.req.query('returnTo'),
      returnToFallback: DEFAULT_RETURN_TO,
    });
    if (!authUrl) return c.json({ error: `${name} calendar is not configured` }, 503);
    return c.json({ authUrl });
  });

  // GET /callback/:provider — provider redirect (PUBLIC; authed by signed state).
  r.get('/callback/:provider', async (c) => {
    const env = c.env as Env;
    const name = c.req.param('provider');
    const provider = getCalendarProvider(name);
    const base = resolveAppBaseUrl(env);
    const code = c.req.query('code');
    const rawState = c.req.query('state');
    if (!provider || !code || !rawState) return c.redirect(`${base}${DEFAULT_RETURN_TO}?calendar=error`);

    const result = await completeProviderOAuthCallback(env, provider, {
      providerName: name, code, rawState, redirectUri: callbackUrl(c, name),
    });
    if (!result.ok) {
      if (result.reason === 'exchange_failed') {
        reportCaughtError(result.error, { source: 'presentation/routes/calendarRoutes.ts', operation: 'callback' });
      }
      const returnTo = result.returnTo ?? DEFAULT_RETURN_TO;
      const outcome = result.reason === 'exchange_failed' ? 'error' : result.reason;
      return c.redirect(`${base}${returnTo}?calendar=${outcome}`);
    }
    const { state, tokens: tok } = result;

    try {
      // Resolve the connected account email.
      let accountEmail = '';
      try {
        const info = await fetch(provider.accountInfoUrl, { headers: { Authorization: `Bearer ${tok.access_token}` } });
        if (info.ok) accountEmail = provider.parseAccountEmail(await info.json() as Record<string, unknown>);
      } catch (error) { /* email is best-effort */ 
        reportCaughtError(error, { source: "presentation/routes/calendarRoutes.ts", operation: "createCalendarRoutes" });
      }

      await upsertCalendarGrant(db, env, {
        tenantId: state.tenantId,
        userId: state.userId,
        // `provider.name` rather than the raw path param: the provider was already
        // resolved from it, so this is the validated value and it carries the type.
        provider: provider.name,
        accountEmail: accountEmail || null,
        tokens: tok,
        defaultScope: provider.scopes.join(' '),
      });
      return c.redirect(`${base}${state.returnTo}?calendar=connected`);
    } catch (error) {
      reportCaughtError(error, { source: 'presentation/routes/calendarRoutes.ts', operation: 'callback' });
      return c.redirect(`${base}${state.returnTo}?calendar=error`);
    }
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
    const days = Math.min(60, Math.max(1, Number(c.req.query('days') ?? 14)));
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
