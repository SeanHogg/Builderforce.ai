/**
 * Enterprise SSO — /api/auth/sso (public) and /api/sso-connections (admin).
 *
 * Two routers from one module because they are two halves of one feature and the
 * mounting difference is the whole point: the login half is reached by somebody
 * with NO session (that is what signing in means) and must carry no auth
 * middleware, while the admin half is manager-gated. Splitting them across files
 * is how one ends up under the wrong middleware.
 *
 * ── WHY THE SESSION IS ESTABLISHED THE SAME WAY OAUTH DOES IT ────────────────
 * The callback redirects to `/auth/callback?code=<envelope>` and the browser
 * swaps it through the EXISTING `POST /api/auth/oauth/exchange`. A 24h session
 * JWT in a URL is captured by analytics as `page_location`, leaks through
 * `Referer`, and stays in browser history — the OAuth path already solved that
 * with a 60-second, single-purpose HMAC envelope that is useless as an API
 * bearer, and a second sign-in path inventing its own answer is how one of the
 * two gets it wrong.
 *
 * LAYER: parses, authorises, serialises. The protocol, the crypto and the
 * domain-routing rules are in `application/auth/enterpriseSso.ts`.
 */

import { Hono, type Context } from 'hono';
import { and, eq } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import { resolveApiOrigin, resolveAppBaseUrl, type Env, type HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { signState, verifyState } from '../../infrastructure/auth/oauthState';
import { oauthAccounts, tenantMembers, users } from '../../infrastructure/database/schema';
import { ensureStarterWorkspace } from '../../application/tenant/starterWorkspace';
import {
  SsoError,
  addDomain,
  completeSsoLogin,
  connectionById,
  connectionForEmail,
  createConnection,
  deleteConnection,
  identityIsInScope,
  listConnections,
  removeDomain,
  ssoChallengeRecordName,
  startSsoLogin,
  updateConnection,
  verifyDomain,
  type SsoConnectionInput,
} from '../../application/auth/enterpriseSso';

const handle = async (run: () => Promise<Response>): Promise<Response> => {
  try {
    return await run();
  } catch (error) {
    if (error instanceof SsoError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
};

/** `oauth_accounts.provider` for an SSO identity. One value, with the connection
 *  id inside the account id, so two institutions' identically-numbered subjects
 *  stay distinct under `uq_oauth_provider_account`. */
const SSO_PROVIDER = 'sso';
const ssoAccountId = (connectionId: number, subject: string): string => `${connectionId}|${subject}`.slice(0, 255);

/** Only a same-origin relative path survives. Same guard as the OAuth routes —
 *  the check has to exist on every path that echoes a redirect back. */
function safeRedirect(path: string | null | undefined): string {
  return typeof path === 'string'
    && path.startsWith('/')
    && !path.startsWith('//')
    && !path.includes('://')
    && !path.includes('\\')
    ? path
    : '/dashboard';
}

// ---------------------------------------------------------------------------
// The public half — signing in
// ---------------------------------------------------------------------------

export function createSsoLoginRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  const callbackUrl = (c: Context<HonoEnv>) => `${resolveApiOrigin(c.env)}/api/auth/sso/callback`;

  /**
   * Does this address sign in through an institution?
   *
   * The login page calls this as the person types their address so the password
   * field can be replaced by "Continue with <institution>". It answers with the
   * connection's LABEL and nothing else — an unauthenticated probe must not be
   * able to enumerate a workspace's issuer, client id or endpoints.
   */
  router.get('/discover', (c) => handle(async () => {
    const email = (c.req.query('email') ?? '').trim().toLowerCase();
    const connection = email.includes('@') ? await connectionForEmail(db, email) : null;
    return Response.json(connection
      ? { sso: true, connectionId: connection.id, label: connection.label }
      : { sso: false });
  }));

  /**
   * Send the person to their identity provider.
   *
   * `state` carries the connection id, the post-login redirect AND the nonce,
   * HMAC-signed with a 10-minute life. The nonce has to survive the round trip
   * and there is no session to keep it in — a cookie would be dropped by the
   * cross-site redirect chain some IdPs perform, so it rides the state it is
   * bound to instead.
   */
  router.get('/start', (c) => handle(async () => {
    const email = (c.req.query('email') ?? '').trim().toLowerCase();
    const byId = Number(c.req.query('connection'));
    const connection = Number.isFinite(byId) && byId > 0
      ? await connectionById(db, byId)
      : await connectionForEmail(db, email);
    if (!connection) {
      throw new SsoError('That address does not belong to a workspace with single sign-on. Sign in with your password, or ask your administrator to connect your domain.', 404);
    }

    const redirect = safeRedirect(c.req.query('redirect'));
    // The nonce is minted by the service and signed INTO the state here — the
    // authorization URL comes back without one precisely so the two cannot
    // disagree, and the callback rejects itself if they ever do.
    const started = await startSsoLogin(c.env as Env, connection, callbackUrl(c));
    const state = await signState(c.env.JWT_SECRET, {
      cid: connection.id,
      nonce: started.nonce,
      redirect,
    });
    const url = new URL(started.url);
    url.searchParams.set('state', state);
    return Response.redirect(url.toString(), 302);
  }));

  /** The identity provider sends the person back here. */
  router.get('/callback', async (c) => {
    const frontend = resolveAppBaseUrl(c.env);
    const fail = (reason: string) => c.redirect(`${frontend}/login?error=${encodeURIComponent(reason)}`, 302);

    const code = c.req.query('code') ?? '';
    const state = c.req.query('state') ?? '';
    if (!code || !state) return fail('sso_missing_params');

    // 10 minutes: long enough for an IdP that shows a consent screen and an MFA
    // prompt, short enough that a captured authorization URL is not a standing
    // invitation.
    const parsed = await verifyState<{ cid: number; nonce: string; redirect: string }>(
      c.env.JWT_SECRET, state, 600_000,
    );
    if (!parsed?.cid || !parsed.nonce) return fail('sso_invalid_state');

    const connection = await connectionById(db, parsed.cid);
    if (!connection) return fail('sso_connection_unavailable');

    const completed = await completeSsoLogin(
      c.env as Env, db, connection, code, `${resolveApiOrigin(c.env)}/api/auth/sso/callback`, parsed.nonce,
    );
    if (!completed.ok) return fail(completed.error);

    const { identity } = completed;
    // Checked AFTER the provider answers as well as before. The domain decided
    // where to send the person; it must also decide whether the identity that
    // came back is one this connection is allowed to assert — otherwise a
    // misconfigured multi-tenant gateway could return any address at all.
    if (!await identityIsInScope(db, connection, identity.email)) {
      return fail('sso_domain_not_permitted');
    }

    const accountId = ssoAccountId(connection.id, identity.subject);
    const [bound] = await db
      .select({ userId: oauthAccounts.userId })
      .from(oauthAccounts)
      .where(and(eq(oauthAccounts.provider, SSO_PROVIDER), eq(oauthAccounts.providerAccountId, accountId)))
      .limit(1);

    let userId = bound?.userId ?? '';
    if (!userId) {
      const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, identity.email)).limit(1);
      userId = existing?.id ?? '';
      if (!userId) {
        // The connection's own switch. Off means the IdP authenticated somebody
        // real and we still refuse — which is what an institution that
        // provisions seats by hand is asking for, and it must not be silently
        // overridden by a successful login.
        if (!connection.jitProvisioning) return fail('sso_account_not_provisioned');
        userId = crypto.randomUUID();
        const username = identity.email.split('@')[0]!.replace(/[^a-z0-9_]/gi, '_').toLowerCase().slice(0, 20)
          || `user_${crypto.randomUUID().slice(0, 8)}`;
        await db.insert(users).values({
          id: userId,
          email: identity.email,
          username: `${username}_${crypto.randomUUID().slice(0, 4)}`,
          displayName: identity.name,
          passwordHash: null,
          apiKeyHash: null,
          // The institution's IdP vouched for the address — exactly what OAuth
          // vouching is — so the account skips the signup OTP gate.
          emailVerifiedAt: new Date(),
        });
        await ensureStarterWorkspace(c.env as Env, db, {
          id: userId,
          email: identity.email,
          username,
          displayName: identity.name,
        });
      }
      await db.insert(oauthAccounts).values({
        userId,
        provider: SSO_PROVIDER,
        providerAccountId: accountId,
        email: identity.email,
        displayName: identity.name,
      }).onConflictDoNothing({ target: [oauthAccounts.provider, oauthAccounts.providerAccountId] });
    }

    // Membership in the workspace that owns the connection, at the role IT
    // declared. Added on every sign-in rather than only at creation: an
    // administrator who connects a domain expects existing accounts on it to
    // arrive in their workspace, not only ones created afterwards.
    const [member] = await db
      .select({ id: tenantMembers.id })
      .from(tenantMembers)
      .where(and(eq(tenantMembers.tenantId, connection.tenantId), eq(tenantMembers.userId, userId)))
      .limit(1);
    if (!member) {
      await db.insert(tenantMembers).values({
        tenantId: connection.tenantId,
        userId,
        role: (['owner', 'manager', 'developer', 'viewer'] as const).includes(connection.defaultRole as 'viewer')
          ? connection.defaultRole as 'viewer'
          : 'developer',
      });
    }

    const [user] = await db.select({ id: users.id, isSuspended: users.isSuspended }).from(users).where(eq(users.id, userId)).limit(1);
    if (!user) return fail('sso_account_not_found');
    if (user.isSuspended) return fail('account_suspended');

    const exchange = await signState(c.env.JWT_SECRET, {
      uid: userId,
      amr: 'sso',
      redirect: safeRedirect(parsed.redirect),
    });
    return c.redirect(`${frontend}/auth/callback?code=${encodeURIComponent(exchange)}`, 302);
  });

  return router;
}

// ---------------------------------------------------------------------------
// The admin half — connecting an institution
// ---------------------------------------------------------------------------

function readInput(body: Record<string, unknown>): SsoConnectionInput {
  const str = (key: string): string | null => (typeof body[key] === 'string' ? body[key] as string : null);
  return {
    label: String(body.label ?? ''),
    protocol: str('protocol') ?? undefined,
    issuer: String(body.issuer ?? ''),
    discoveryUrl: str('discoveryUrl'),
    authorizationUrl: str('authorizationUrl'),
    tokenUrl: str('tokenUrl'),
    jwksUrl: str('jwksUrl'),
    userinfoUrl: str('userinfoUrl'),
    clientId: String(body.clientId ?? ''),
    ...(str('clientSecret') ? { clientSecret: str('clientSecret')! } : {}),
    ...(str('scopes') ? { scopes: str('scopes')! } : {}),
    ...(typeof body.jitProvisioning === 'boolean' ? { jitProvisioning: body.jitProvisioning } : {}),
    ...(str('defaultRole') ? { defaultRole: str('defaultRole')! } : {}),
  };
}

export function createSsoAdminRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);
  router.use('*', requireRole(TenantRole.MANAGER));

  const tenant = (c: Context<HonoEnv>) => c.get('tenantId') as number;
  const id = (c: Context<HonoEnv>) => Number(c.req.param('id'));

  /** The connections, plus the redirect URI an administrator has to register on
   *  the identity provider's side — the single most common cause of a connection
   *  that fails with `redirect_uri_mismatch` is that value typed from memory. */
  router.get('/', (c) => handle(async () => Response.json({
    connections: await listConnections(db, tenant(c)),
    redirectUri: `${resolveApiOrigin(c.env)}/api/auth/sso/callback`,
  })));

  router.post('/', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
    const connection = await createConnection(
      c.env as Env, db, tenant(c), readInput(body), (c.get('userId') as string | undefined) ?? null,
    );
    return Response.json({ connection }, { status: 201 });
  }));

  router.put('/:id', (c) => handle(async () => {
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
    return Response.json({ connection: await updateConnection(c.env as Env, db, tenant(c), id(c), readInput(body)) });
  }));

  router.delete('/:id', (c) => handle(async () => {
    await deleteConnection(c.env as Env, db, tenant(c), id(c));
    return Response.json({ ok: true });
  }));

  /** Claim a domain. The response is the exact TXT record to publish, because a
   *  half-remembered record name is a verification that never succeeds and never
   *  says why. */
  router.post('/:id/domains', (c) => handle(async () => {
    const body = await c.req.json<{ domain?: string }>().catch((): { domain?: string } => ({}));
    const added = await addDomain(db, tenant(c), id(c), String(body.domain ?? ''));
    return Response.json({
      domain: added.domain,
      recordName: ssoChallengeRecordName(added.domain),
      recordValue: added.verifyToken,
    }, { status: 201 });
  }));

  router.post('/domains/:domainId/verify', (c) => handle(async () => {
    return Response.json(await verifyDomain(db, tenant(c), Number(c.req.param('domainId'))));
  }));

  router.delete('/domains/:domainId', (c) => handle(async () => {
    await removeDomain(db, tenant(c), Number(c.req.param('domainId')));
    return Response.json({ ok: true });
  }));

  return router;
}
