/**
 * Connected mailboxes — `/api/mailbox/*`
 *
 * OAuth grants on a real Microsoft 365 or Gmail mailbox, plus the read surface
 * the canvas inbox and the Brain triage tools sit on.
 *
 * Auth model mirrors {@link ./calendarRoutes}: every endpoint is bearer-authed
 * EXCEPT `/callback/:provider`, which is a top-level browser redirect FROM the
 * provider and therefore has no bearer to carry. That one is authenticated by the
 * HMAC-signed `state` round-tripped through the provider, which names the
 * connecting user and tenant — the same primitive the calendar flow uses, so the
 * CSRF story lives in exactly one place.
 *
 * Connecting is DEVELOPER-level (it grants access to your own mailbox), but
 * turning a mailbox into something a campaign can blast from is MANAGER-gated —
 * the same bar as every other route that can reach a stranger's inbox.
 */
import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import { resolveAppBaseUrl, type Env, type HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { signState, verifyState, exchangeCodeForTokens } from '../../infrastructure/auth/oauthState';
import {
  availableMailboxProviders,
  clampMailboxLimit,
  getMailboxProvider,
  type MailboxQuery,
} from '../../application/mailbox/mailboxProviders';
import {
  deleteMailboxConnection,
  listMailboxConnections,
  readMailbox,
  readMailboxMessage,
  saveMailboxConnection,
  setMailboxSending,
  toTriageMessages,
} from '../../application/mailbox/mailboxService';
import { reportCaughtError } from '../../application/observability/caughtErrorReporter';

interface MailboxState extends Record<string, unknown> {
  provider: string;
  userId: string;
  tenantId: number;
  returnTo: string;
}

/** Where the connect flow sends the browser back to. Constrained to a path on
 *  our own app so a crafted `returnTo` cannot turn the callback into an open
 *  redirect to an attacker's host. */
function safeReturnTo(raw: string | undefined): string {
  const value = (raw ?? '').trim();
  return value.startsWith('/') && !value.startsWith('//') ? value : '/growth';
}

/** Parse the shared inbox-filter query string. ONE parser, so the REST route and
 *  the MCP tools cannot disagree about what `unread=true` means. */
export function parseMailboxQuery(get: (key: string) => string | undefined): MailboxQuery {
  const truthy = (v: string | undefined) => v === 'true' || v === '1';
  return {
    search: get('q')?.trim() || undefined,
    from: get('from')?.trim() || undefined,
    subject: get('subject')?.trim() || undefined,
    unreadOnly: truthy(get('unread')),
    hasAttachments: truthy(get('hasAttachments')),
    afterISO: get('after')?.trim() || undefined,
    beforeISO: get('before')?.trim() || undefined,
    limit: clampMailboxLimit(get('limit')),
  };
}

export function createMailboxRoutes(db: Db): Hono<HonoEnv> {
  const r = new Hono<HonoEnv>();
  const manager = requireRole(TenantRole.MANAGER);

  r.use('*', async (c, next) => {
    if (c.req.path.includes('/callback/')) return next();
    return authMiddleware(c, next);
  });

  const callbackUrl = (c: { req: { url: string } }, provider: string) =>
    `${new URL(c.req.url).origin}/api/mailbox/callback/${provider}`;

  // GET /providers — what this deployment can offer + what is already connected.
  r.get('/providers', async (c) => c.json({
    providers: availableMailboxProviders(c.env as unknown as Record<string, unknown>),
    connections: await listMailboxConnections(db, c.get('tenantId') as number),
  }));

  // GET /connections — just the connected mailboxes (the polling shape).
  r.get('/connections', async (c) =>
    c.json({ connections: await listMailboxConnections(db, c.get('tenantId') as number) }));

  /**
   * GET /connect/:provider — build the consent URL.
   *
   * Returned as JSON for the client to navigate to, rather than a 302 from here:
   * a top-level navigation cannot carry the bearer token, so the browser must
   * make the jump itself after an authenticated fetch.
   */
  r.get('/connect/:provider', async (c) => {
    const env = c.env as Env;
    const name = c.req.param('provider');
    const provider = getMailboxProvider(name);
    if (!provider) return c.json({ error: 'Unknown mailbox provider.' }, 400);

    const rec = env as unknown as Record<string, string | undefined>;
    if (!rec[provider.clientIdKey] || !rec[provider.clientSecretKey]) {
      return c.json({ error: `${provider.label} is not configured on this deployment.` }, 503);
    }

    const state = await signState(env.JWT_SECRET, {
      provider: name,
      userId: c.get('userId'),
      tenantId: c.get('tenantId'),
      returnTo: safeReturnTo(c.req.query('returnTo')),
    } satisfies MailboxState);

    const params = new URLSearchParams({
      client_id: rec[provider.clientIdKey]!,
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
    const provider = getMailboxProvider(name);
    const base = resolveAppBaseUrl(env);
    const code = c.req.query('code');
    const rawState = c.req.query('state');

    // The user declining consent is a normal outcome, not an error — say so.
    if (c.req.query('error')) return c.redirect(`${base}/growth?mailbox=declined`);
    if (!provider || !code || !rawState) return c.redirect(`${base}/growth?mailbox=error`);

    const state = await verifyState<MailboxState>(env.JWT_SECRET, rawState);
    if (!state || state.provider !== name) return c.redirect(`${base}/growth?mailbox=invalid_state`);

    const rec = env as unknown as Record<string, string | undefined>;
    const clientId = rec[provider.clientIdKey];
    const clientSecret = rec[provider.clientSecretKey];
    if (!clientId || !clientSecret) return c.redirect(`${base}${state.returnTo}?mailbox=unavailable`);

    try {
      const tok = await exchangeCodeForTokens(
        { tokenUrl: provider.tokenUrl, clientId, clientSecret }, code, callbackUrl(c, name),
      );
      // The mailbox address is not optional the way a calendar's is: it is the
      // From: of every campaign and the natural key of the row, so a grant we
      // cannot name is refused rather than stored half-identified.
      const account = await provider.accountInfo(tok.access_token);
      if (!account.email) return c.redirect(`${base}${state.returnTo}?mailbox=no_account`);

      await saveMailboxConnection(db, env, {
        tenantId: state.tenantId,
        userId: state.userId,
        provider: provider.name,
        accountEmail: account.email,
        displayName: account.displayName,
        accessToken: tok.access_token,
        refreshToken: tok.refresh_token,
        expiresInSeconds: tok.expires_in,
        scope: tok.scope ?? provider.scopes.join(' '),
      });
      return c.redirect(`${base}${state.returnTo}?mailbox=connected`);
    } catch (error) {
      reportCaughtError(error, { source: 'presentation/routes/mailboxRoutes.ts', operation: 'callback' });
      return c.redirect(`${base}${state.returnTo}?mailbox=error`);
    }
  });

  // PATCH /connections/:id — the sending opt-in/out. Manager-gated: this is what
  // turns a private mailbox into something that can email strangers.
  r.patch('/connections/:id', manager, async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'Invalid connection id.' }, 400);
    const body = await c.req.json<{ allowSending?: boolean }>().catch(() => ({}) as never);
    if (typeof body.allowSending !== 'boolean') return c.json({ error: 'allowSending must be a boolean.' }, 400);
    const updated = await setMailboxSending(db, c.get('tenantId') as number, id, body.allowSending);
    if (!updated) return c.json({ error: 'Mailbox connection not found.' }, 404);
    return c.json(updated);
  });

  r.delete('/connections/:id', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'Invalid connection id.' }, 400);
    await deleteMailboxConnection(db, c.get('tenantId') as number, id);
    return c.body(null, 204);
  });

  /**
   * GET /connections/:id/messages — the inbox.
   *
   * Deliberately NOT cached through getOrSetCached: a stale inbox is a wrong
   * inbox, and the tenant-scoped result here is one upstream call whose freshness
   * is the entire product. `lastSyncedAt` on the connection is how the UI shows
   * when it last read true.
   */
  r.get('/connections/:id/messages', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'Invalid connection id.' }, 400);
    const query = parseMailboxQuery((key) => c.req.query(key));
    const result = await readMailbox(db, c.env as Env, c.get('tenantId') as number, id, query);
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json({
      messages: result.messages,
      // The compact projection alongside the full one, so the canvas tile and a
      // model reading the same response never re-derive it differently.
      triage: toTriageMessages(result.messages),
      accountEmail: result.accountEmail,
      provider: result.provider,
    });
  });

  r.get('/connections/:id/messages/:messageId', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'Invalid connection id.' }, 400);
    const result = await readMailboxMessage(
      db, c.env as Env, c.get('tenantId') as number, id, c.req.param('messageId'),
    );
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json(result.message);
  });

  return r;
}
