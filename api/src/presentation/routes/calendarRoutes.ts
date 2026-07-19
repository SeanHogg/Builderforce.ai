/**
 * Calendar connections — /api/calendar/*
 *
 * Per-USER OAuth grants (Google Calendar / Microsoft Graph) used to schedule
 * meetings and surface upcoming events. Reuses the shared OAuth state/token
 * primitives ({@link ../../infrastructure/auth/oauthState}) and the provider
 * adapters ({@link ../../application/calendar/calendarProviders}).
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
import { signState, verifyState, exchangeCodeForTokens } from '../../infrastructure/auth/oauthState';
import {
  getCalendarProvider, availableCalendarProviders, type CalendarProviderName, type CalendarEvent,
} from '../../application/calendar/calendarProviders';
import { freshAccessToken } from '../../application/calendar/calendarService';

interface CalendarState extends Record<string, unknown> {
  provider: string;
  userId: string;
  tenantId: number;
  returnTo: string;
}

export function createCalendarRoutes(db: Db): Hono<HonoEnv> {
  const r = new Hono<HonoEnv>();

  // Bearer-auth everything except the provider redirect callback.
  r.use('*', async (c, next) => {
    if (c.req.path.includes('/callback/')) return next();
    return authMiddleware(c, next);
  });

  const callbackUrl = (c: { req: { url: string } }, provider: string) =>
    `${new URL(c.req.url).origin}/api/calendar/callback/${provider}`;
  const appBase = (env: Env) => (env.APP_URL ?? 'https://builderforce.ai').replace(/\/$/, '');

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
    const rec = env as unknown as Record<string, string | undefined>;
    const clientId = rec[provider.clientIdKey as string];
    if (!clientId) return c.json({ error: `${name} calendar is not configured` }, 503);

    const returnTo = c.req.query('returnTo') || '/meetings';
    const state = await signState(env.JWT_SECRET, {
      provider: name, userId: c.get('userId'), tenantId: c.get('tenantId'), returnTo,
    } satisfies CalendarState);

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: callbackUrl(c, name),
      response_type: 'code',
      scope: provider.scopes.join(' '),
      state,
      ...(provider.extraAuthParams ?? {}),
    });
    return c.json({ authUrl: `${provider.authUrl}?${params}` });
  });

  // GET /callback/:provider — provider redirect (PUBLIC; authed by signed state).
  r.get('/callback/:provider', async (c) => {
    const env = c.env as Env;
    const name = c.req.param('provider');
    const provider = getCalendarProvider(name);
    const base = appBase(env);
    const code = c.req.query('code');
    const rawState = c.req.query('state');
    if (!provider || !code || !rawState) return c.redirect(`${base}/meetings?calendar=error`);

    const state = await verifyState<CalendarState>(env.JWT_SECRET, rawState);
    if (!state || state.provider !== name) return c.redirect(`${base}/meetings?calendar=invalid_state`);

    const rec = env as unknown as Record<string, string | undefined>;
    const clientId = rec[provider.clientIdKey as string];
    const clientSecret = rec[provider.clientSecretKey as string];
    if (!clientId || !clientSecret) return c.redirect(`${base}${state.returnTo}?calendar=unavailable`);

    try {
      const tok = await exchangeCodeForTokens(
        { tokenUrl: provider.tokenUrl, clientId, clientSecret }, code, callbackUrl(c, name),
      );
      // Resolve the connected account email.
      let accountEmail = '';
      try {
        const info = await fetch(provider.accountInfoUrl, { headers: { Authorization: `Bearer ${tok.access_token}` } });
        if (info.ok) accountEmail = provider.parseAccountEmail(await info.json() as Record<string, unknown>);
      } catch { /* email is best-effort */ }

      const expiresAt = tok.expires_in ? new Date(Date.now() + tok.expires_in * 1000) : null;
      await db.insert(calendarConnections).values({
        tenantId: state.tenantId,
        userId: state.userId,
        provider: name,
        accountEmail: accountEmail || null,
        accessToken: tok.access_token,
        refreshToken: tok.refresh_token ?? null,
        expiresAt,
        scope: tok.scope ?? provider.scopes.join(' '),
      }).onConflictDoUpdate({
        target: [calendarConnections.userId, calendarConnections.provider],
        set: {
          accessToken: tok.access_token,
          // Google omits refresh_token on re-consent unless prompt=consent; keep old if absent.
          refreshToken: tok.refresh_token ?? undefined,
          accountEmail: accountEmail || null,
          expiresAt,
          scope: tok.scope ?? provider.scopes.join(' '),
          tenantId: state.tenantId,
          updatedAt: new Date(),
        },
      });
      return c.redirect(`${base}${state.returnTo}?calendar=connected`);
    } catch {
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
      } catch { /* skip a failing provider, still return the rest */ }
    }
    all.sort((a, b) => a.startISO.localeCompare(b.startISO));
    return c.json({ events: all });
  });

  return r;
}
