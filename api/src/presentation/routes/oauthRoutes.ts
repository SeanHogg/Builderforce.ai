import { Hono, type Context } from 'hono';
import { and, eq, sql } from 'drizzle-orm';
import type { HonoEnv, Env } from '../../env';
import { webAuthMiddleware } from '../middleware/webAuthMiddleware';
import { sendMagicLinkEmail } from '../../infrastructure/email/EmailService';
import {
  users,
  oauthAccounts,
  magicLinkTokens,
  authUserSessions,
  authTokens,
} from '../../infrastructure/database/schema';
import { signWebJwt, verifyWebJwt } from '../../infrastructure/auth/JwtService';
import { hashPassword } from '../../infrastructure/auth/HashService';
import type { Db } from '../../infrastructure/database/connection';

// ---------------------------------------------------------------------------
// Provider configuration
// ---------------------------------------------------------------------------

interface ProviderCfg {
  authUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scopes: string[];
  clientId: string;
  clientSecret: string;
  extraAuthParams?: Record<string, string>;
  parseUser: (d: Record<string, unknown>) => ProviderUser;
}

interface ProviderUser {
  id: string;
  email: string;
  name: string;
  avatar?: string;
}

const PROVIDER_DEFS: Record<
  string,
  {
    authUrl: string;
    tokenUrl: string;
    userInfoUrl: string;
    scopes: string[];
    extraAuthParams?: Record<string, string>;
    clientIdKey: keyof Env;
    clientSecretKey: keyof Env;
    parseUser: (d: Record<string, unknown>) => ProviderUser;
  }
> = {
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
    scopes: ['openid', 'email', 'profile'],
    extraAuthParams: { access_type: 'offline', prompt: 'select_account' },
    clientIdKey: 'GOOGLE_CLIENT_ID',
    clientSecretKey: 'GOOGLE_CLIENT_SECRET',
    parseUser: (d) => ({
      id: String(d.sub ?? ''),
      email: String(d.email ?? ''),
      name: String(d.name ?? d.email ?? ''),
      avatar: d.picture ? String(d.picture) : undefined,
    }),
  },
  linkedin: {
    authUrl: 'https://www.linkedin.com/oauth/v2/authorization',
    tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
    userInfoUrl: 'https://api.linkedin.com/v2/userinfo',
    scopes: ['openid', 'profile', 'email'],
    clientIdKey: 'LINKEDIN_CLIENT_ID',
    clientSecretKey: 'LINKEDIN_CLIENT_SECRET',
    parseUser: (d) => ({
      id: String(d.sub ?? ''),
      email: String(d.email ?? ''),
      name: String(
        d.name ||
        `${d.given_name || ''} ${d.family_name || ''}`.trim() ||
        d.email ||
        ''
      ),
      avatar: d.picture ? String(d.picture) : undefined,
    }),
  },
  github: {
    authUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    scopes: ['read:user', 'user:email'],
    clientIdKey: 'GITHUB_CLIENT_ID',
    clientSecretKey: 'GITHUB_CLIENT_SECRET',
    parseUser: (d) => ({
      id: String(d.id ?? ''),
      email: String(d.email ?? ''),
      name: String(d.name ?? d.login ?? d.email ?? ''),
      avatar: d.avatar_url ? String(d.avatar_url) : undefined,
    }),
  },
  microsoft: {
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    userInfoUrl: 'https://graph.microsoft.com/v1.0/me',
    scopes: ['openid', 'profile', 'email', 'User.Read'],
    clientIdKey: 'MICROSOFT_CLIENT_ID',
    clientSecretKey: 'MICROSOFT_CLIENT_SECRET',
    parseUser: (d) => ({
      id: String(d.id ?? ''),
      email: String(d.mail ?? d.userPrincipalName ?? ''),
      name: String(d.displayName ?? d.mail ?? ''),
    }),
  },
};

function getProviderCfg(name: string, env: Env): ProviderCfg | null {
  const def = PROVIDER_DEFS[name];
  if (!def) return null;
  const clientId = (env as unknown as Record<string, string | undefined>)[def.clientIdKey] ?? '';
  const clientSecret = (env as unknown as Record<string, string | undefined>)[def.clientSecretKey] ?? '';
  if (!clientId || !clientSecret) return null;
  return { ...def, clientId, clientSecret };
}

// ---------------------------------------------------------------------------
// HMAC-signed OAuth state — CSRF protection without DB storage
// ---------------------------------------------------------------------------

async function createOAuthState(jwtSecret: string, redirect: string, linkUserId?: string): Promise<string> {
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const payload = JSON.stringify({
    nonce,
    redirect: redirect || '/dashboard',
    ts: Date.now(),
    ...(linkUserId ? { linkUserId } : {}),
  });
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(jwtSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const sigHex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return btoa(payload + '|' + sigHex);
}

async function verifyOAuthState(
  jwtSecret: string,
  state: string,
): Promise<{ redirect: string; linkUserId?: string } | null> {
  try {
    const decoded = atob(state);
    const sepIdx = decoded.lastIndexOf('|');
    const payload = decoded.slice(0, sepIdx);
    const sigHex = decoded.slice(sepIdx + 1);
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(jwtSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const sigBytes = new Uint8Array(sigHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBytes,
      new TextEncoder().encode(payload),
    );
    if (!valid) return null;
    const { redirect, ts, linkUserId } = JSON.parse(payload) as {
      redirect: string;
      ts: number;
      linkUserId?: string;
    };
    if (Date.now() - ts > 10 * 60 * 1000) return null; // 10-minute window
    return { redirect, linkUserId };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// OAuth code exchange + user info fetch
// ---------------------------------------------------------------------------

async function exchangeCode(
  cfg: Pick<ProviderCfg, 'tokenUrl' | 'clientId' | 'clientSecret'>,
  code: string,
  callbackUrl: string,
): Promise<{ access_token: string; refresh_token?: string }> {
  const res = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code,
      redirect_uri: callbackUrl,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`);
  const data = (await res.json()) as { access_token?: string; refresh_token?: string };
  if (!data.access_token) throw new Error('No access_token in response');
  return { access_token: data.access_token, refresh_token: data.refresh_token };
}

async function fetchUserInfo(
  userInfoUrl: string,
  accessToken: string,
): Promise<Record<string, unknown>> {
  const res = await fetch(userInfoUrl, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`User info fetch failed: ${res.status}`);
  return res.json() as Promise<Record<string, unknown>>;
}

async function getGitHubEmail(accessToken: string): Promise<string> {
  const res = await fetch('https://api.github.com/user/emails', {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (!res.ok) return '';
  const emails = (await res.json()) as Array<{
    email: string;
    primary: boolean;
    verified: boolean;
  }>;
  return emails.find((e) => e.primary && e.verified)?.email ?? emails[0]?.email ?? '';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

function getClientIp(c: Context<HonoEnv>): string | null {
  const cfIp = c.req.header('CF-Connecting-IP');
  if (cfIp) return cfIp.trim();
  const xff = c.req.header('X-Forwarded-For');
  if (!xff) return null;
  return xff.split(',')[0]?.trim() ?? null;
}

function getUserAgent(c: Context<HonoEnv>): string | null {
  const ua = c.req.header('User-Agent');
  return ua ? ua.slice(0, 1024) : null;
}

async function generateUsername(db: Db, email: string): Promise<string> {
  const base = email
    .split('@')[0]!
    .replace(/[^a-z0-9_]/gi, '_')
    .toLowerCase()
    .slice(0, 20);
  for (let i = 0; i < 5; i++) {
    const candidate = i === 0 ? base : `${base.slice(0, 16)}_${randomHex(2)}`;
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, candidate))
      .limit(1);
    if (!existing) return candidate;
  }
  return `user_${randomHex(4)}`;
}

// ---------------------------------------------------------------------------
// Token persistence — mirrors the pattern in authRoutes.ts
// ---------------------------------------------------------------------------

async function persistWebToken(
  db: Db,
  token: string,
  opts: {
    userId: string;
    userAgent?: string | null;
    ipAddress?: string | null;
    sessionName?: string | null;
  },
): Promise<void> {
  const parts = token.split('.');
  if (parts.length !== 3) return;

  let payload: { jti?: string; sid?: string; exp?: number };
  try {
    const b64 = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
    payload = JSON.parse(atob(b64)) as typeof payload;
  } catch {
    return;
  }

  if (!payload.jti) return;

  const sessionId = payload.sid;
  if (sessionId) {
    const [existing] = await db
      .select({ id: authUserSessions.id })
      .from(authUserSessions)
      .where(eq(authUserSessions.id, sessionId))
      .limit(1);
    if (!existing) {
      await db.insert(authUserSessions).values({
        id: sessionId,
        userId: opts.userId,
        sessionName: opts.sessionName ?? null,
        userAgent: opts.userAgent ?? null,
        ipAddress: opts.ipAddress ?? null,
      });
    }
  }

  await db.insert(authTokens).values({
    jti: payload.jti,
    userId: opts.userId,
    sessionId: sessionId ?? null,
    tenantId: null,
    tokenType: 'web',
    issuedAt: new Date(),
    expiresAt: payload.exp ? new Date(payload.exp * 1000) : new Date(Date.now() + 86_400_000),
    userAgent: opts.userAgent ?? null,
    ipAddress: opts.ipAddress ?? null,
  });
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export function createOAuthRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // -------------------------------------------------------------------------
  // GET /api/auth/oauth/:provider   — initiate OAuth login
  // -------------------------------------------------------------------------
  router.get('/oauth/:provider', async (c) => {
    const name = c.req.param('provider').toLowerCase();
    const cfg = getProviderCfg(name, c.env);
    if (!cfg) return c.json({ error: 'Provider not available' }, 503);

    const redirect = c.req.query('redirect') || '/dashboard';

    // Optional: if the user is already logged in (connecting from Settings),
    // verify their JWT and embed the userId in state so the callback can link
    // to the existing account without relying on email matching.
    let linkUserId: string | undefined;
    const linkToken = c.req.query('link_token');
    if (linkToken) {
      try {
        const linkPayload = await verifyWebJwt(linkToken, c.env.JWT_SECRET);
        linkUserId = linkPayload.sub;
      } catch { /* invalid token — fall through to normal login flow */ }
    }

    const state = await createOAuthState(c.env.JWT_SECRET, redirect, linkUserId);

    // Build callback URL from the incoming request's origin so it works in
    // both local dev and production without an extra env var.
    const origin = new URL(c.req.url).origin;
    const callbackUrl = `${origin}/api/auth/oauth/${name}/callback`;

    const params = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: callbackUrl,
      response_type: 'code',
      scope: cfg.scopes.join(' '),
      state,
      ...cfg.extraAuthParams,
    });

    return c.redirect(`${cfg.authUrl}?${params.toString()}`);
  });

  // -------------------------------------------------------------------------
  // GET /api/auth/oauth/:provider/callback   — OAuth callback
  // -------------------------------------------------------------------------
  router.get('/oauth/:provider/callback', async (c) => {
    const name = c.req.param('provider').toLowerCase();
    const cfg = getProviderCfg(name, c.env);
    const frontendBase = (c.env.APP_URL ?? 'https://builderforce.ai')
      .split(',')[0]!
      .trim();

    if (!cfg) return c.redirect(`${frontendBase}/login?error=provider_unavailable`);

    const code = c.req.query('code');
    const state = c.req.query('state');
    if (!code || !state) return c.redirect(`${frontendBase}/login?error=missing_params`);

    const stateData = await verifyOAuthState(c.env.JWT_SECRET, state);
    if (!stateData) return c.redirect(`${frontendBase}/login?error=invalid_state`);

    const origin = new URL(c.req.url).origin;
    const callbackUrl = `${origin}/api/auth/oauth/${name}/callback`;

    let accessToken: string;
    let refreshToken: string | undefined;
    let providerUser: ProviderUser;

    try {
      const tokens = await exchangeCode(cfg, code, callbackUrl);
      accessToken = tokens.access_token;
      refreshToken = tokens.refresh_token;
      const raw = await fetchUserInfo(cfg.userInfoUrl, accessToken);
      providerUser = cfg.parseUser(raw);
      if (name === 'github' && !providerUser.email) {
        providerUser.email = await getGitHubEmail(accessToken);
      }
    } catch {
      return c.redirect(`${frontendBase}/login?error=auth_failed`);
    }

    // Email is required for new login/signup; the connect flow (linkUserId) can proceed without it
    if (!providerUser.email && !stateData.linkUserId) {
      return c.redirect(`${frontendBase}/login?error=no_email`);
    }

    // 1. Check if this provider account is already linked
    const [existingOAuth] = await db
      .select({ id: oauthAccounts.id, userId: oauthAccounts.userId })
      .from(oauthAccounts)
      .where(
        and(
          eq(oauthAccounts.provider, name),
          eq(oauthAccounts.providerAccountId, providerUser.id),
        ),
      )
      .limit(1);

    let userId: string;

    if (existingOAuth) {
      // Provider already linked — guard against linking to a different account
      if (stateData.linkUserId && existingOAuth.userId !== stateData.linkUserId) {
        return c.redirect(`${frontendBase}/settings?error=already_linked_other`);
      }
      userId = existingOAuth.userId;
      await db
        .update(oauthAccounts)
        .set({ accessToken, refreshToken: refreshToken ?? null, updatedAt: sql`now()` })
        .where(eq(oauthAccounts.id, existingOAuth.id));

    } else if (stateData.linkUserId) {
      // Connect flow: user is logged in and adding a new provider.
      // Use their existing userId directly — do NOT do email lookup.
      // This handles multi-provider linking when provider email differs from account email.
      userId = stateData.linkUserId;
      await db.insert(oauthAccounts).values({
        userId,
        provider: name,
        providerAccountId: providerUser.id,
        email: providerUser.email ? normalizeEmail(providerUser.email) : null,
        displayName: providerUser.name,
        avatarUrl: providerUser.avatar ?? null,
        accessToken,
        refreshToken: refreshToken ?? null,
      });

    } else {
      const normalizedEmail = normalizeEmail(providerUser.email!);

      // 2. Check if a user with the same email already exists (account linking)
      const [existingUser] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, normalizedEmail))
        .limit(1);

      if (existingUser) {
        userId = existingUser.id;
      } else {
        // 3. Create a new user — email is pre-verified via OAuth
        const newId = crypto.randomUUID();
        const username = await generateUsername(db, providerUser.email!);
        await db.insert(users).values({
          id: newId,
          email: normalizedEmail,
          username,
          displayName: providerUser.name,
          avatarUrl: providerUser.avatar ?? null,
          passwordHash: null,
          apiKeyHash: null,
        });
        userId = newId;
      }

      // 4. Link this OAuth provider account
      await db.insert(oauthAccounts).values({
        userId,
        provider: name,
        providerAccountId: providerUser.id,
        email: normalizedEmail,
        displayName: providerUser.name,
        avatarUrl: providerUser.avatar ?? null,
        accessToken,
        refreshToken: refreshToken ?? null,
      });
    }

    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) return c.redirect(`${frontendBase}/login?error=account_not_found`);
    if (user.isSuspended) return c.redirect(`${frontendBase}/login?error=account_suspended`);

    const jwt = await signWebJwt(
      { sub: user.id, email: user.email, username: user.username ?? '', amr: [name] },
      c.env.JWT_SECRET,
      86_400,
    );

    await persistWebToken(db, jwt, {
      userId: user.id,
      sessionName: `OAuth: ${name}`,
      userAgent: getUserAgent(c),
      ipAddress: getClientIp(c),
    });

    return c.redirect(
      `${frontendBase}/auth/callback?token=${encodeURIComponent(jwt)}&redirect=${encodeURIComponent(stateData.redirect)}`,
    );
  });

  // -------------------------------------------------------------------------
  // POST /api/auth/magic-link   — request a magic sign-in link
  // -------------------------------------------------------------------------
  router.post('/magic-link', async (c) => {
    const body = await c.req.json<{ email?: string; redirect?: string }>();
    const normalizedEmail = normalizeEmail(body.email ?? '');
    const redirect = body.redirect || '/dashboard';

    // Always return 200 — never reveal whether an account exists
    if (normalizedEmail) {
      const [user] = await db
        .select({ id: users.id, displayName: users.displayName, username: users.username })
        .from(users)
        .where(eq(users.email, normalizedEmail))
        .limit(1);

      if (user) {
        const token = randomHex(32);

        // Invalidate any existing unused tokens for this email
        await db
          .update(magicLinkTokens)
          .set({ used: true })
          .where(
            and(eq(magicLinkTokens.email, normalizedEmail), eq(magicLinkTokens.used, false)),
          );

        await db.insert(magicLinkTokens).values({
          email: normalizedEmail,
          token,
          expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes
          redirect,
        });

        const frontendBase = (c.env.APP_URL ?? 'https://builderforce.ai')
          .split(',')[0]!
          .trim();
        const magicUrl = `${frontendBase}/auth/magic-link?token=${encodeURIComponent(token)}`;

        void sendMagicLinkEmail(
          c.env,
          normalizedEmail,
          user.displayName ?? user.username ?? normalizedEmail,
          magicUrl,
        );
      }
    }

    return c.json({ message: 'If an account exists for that email, a sign-in link has been sent' });
  });

  // -------------------------------------------------------------------------
  // GET /api/auth/magic-link/verify?token=...   — verify magic link, issue JWT
  // -------------------------------------------------------------------------
  router.get('/magic-link/verify', async (c) => {
    const token = c.req.query('token');
    if (!token) return c.json({ error: 'Token required' }, 400);

    const [row] = await db
      .select()
      .from(magicLinkTokens)
      .where(and(eq(magicLinkTokens.token, token), eq(magicLinkTokens.used, false)))
      .limit(1);

    if (!row || row.expiresAt <= new Date()) {
      return c.json({ error: 'Magic link is invalid or has expired' }, 400);
    }

    // Mark used immediately — single use only
    await db.update(magicLinkTokens).set({ used: true }).where(eq(magicLinkTokens.id, row.id));

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, row.email))
      .limit(1);

    if (!user) return c.json({ error: 'Account not found' }, 401);
    if (user.isSuspended) return c.json({ error: 'Account suspended. Contact support.' }, 403);

    const jwt = await signWebJwt(
      { sub: user.id, email: user.email, username: user.username ?? '', amr: ['magic_link'] },
      c.env.JWT_SECRET,
      86_400,
    );

    await persistWebToken(db, jwt, { userId: user.id, sessionName: 'Magic link' });

    return c.json({
      token: jwt,
      user: {
        id: user.id,
        email: user.email,
        username: user.username ?? '',
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
      },
      redirect: row.redirect || '/dashboard',
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/auth/linked-accounts   — list linked OAuth providers (auth required)
  // -------------------------------------------------------------------------
  router.get('/linked-accounts', webAuthMiddleware, async (c) => {
    const userId = c.var.userId;

    const accounts = await db
      .select({
        provider: oauthAccounts.provider,
        email: oauthAccounts.email,
        displayName: oauthAccounts.displayName,
      })
      .from(oauthAccounts)
      .where(eq(oauthAccounts.userId, userId));

    const [user] = await db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    return c.json({ accounts, hasPassword: !!user?.passwordHash });
  });

  // -------------------------------------------------------------------------
  // DELETE /api/auth/unlink/:provider   — unlink an OAuth provider (auth required)
  // -------------------------------------------------------------------------
  router.delete('/unlink/:provider', webAuthMiddleware, async (c) => {
    const userId = c.var.userId;
    const provider = c.req.param('provider').toLowerCase();

    const [user] = await db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const allLinked = await db
      .select({ id: oauthAccounts.id })
      .from(oauthAccounts)
      .where(eq(oauthAccounts.userId, userId));

    // Block if this is the user's only sign-in method
    if (!user?.passwordHash && allLinked.length <= 1) {
      return c.json(
        { error: 'Cannot disconnect your only sign-in method. Add a password first.' },
        403,
      );
    }

    await db
      .delete(oauthAccounts)
      .where(and(eq(oauthAccounts.userId, userId), eq(oauthAccounts.provider, provider)));

    return c.json({ success: true });
  });

  // -------------------------------------------------------------------------
  // POST /api/auth/add-password   — add a password to an OAuth-only account (auth required)
  // -------------------------------------------------------------------------
  router.post('/add-password', webAuthMiddleware, async (c) => {
    const userId = c.var.userId;
    const body = await c.req.json<{ password?: string }>();

    if (!body.password || body.password.length < 8) {
      return c.json({ error: 'Password must be at least 8 characters' }, 400);
    }

    const [user] = await db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (user?.passwordHash) {
      return c.json({ error: 'Account already has a password' }, 409);
    }

    const hash = await hashPassword(body.password);
    await db
      .update(users)
      .set({ passwordHash: hash, updatedAt: sql`now()` })
      .where(eq(users.id, userId));

    return c.json({ success: true });
  });

  return router;
}
