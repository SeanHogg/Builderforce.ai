import { Hono, type Context } from 'hono';
import { and, desc, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm';
import { AuthService } from '../../application/auth/AuthService';
import type { HonoEnv } from '../../env';
import { webAuthMiddleware } from '../middleware/webAuthMiddleware';
import { TenantRole, type UserId } from '../../domain/shared/types';
import {
  authTokens,
  authUserSessions,
  coderclawInstances,
  legalDocuments,
  newsletterEvents,
  newsletterSubscribers,
  privacyRequests,
  userLegalAcceptances,
  userMfaRecoveryCodes,
  users,
} from '../../infrastructure/database/schema';
import { hashPassword, hashSecret, verifyPassword } from '../../infrastructure/auth/HashService';
import { decodeJwtPayload, signJwt, signWebJwt, verifyWebJwt } from '../../infrastructure/auth/JwtService';
import type { Db } from '../../infrastructure/database/connection';
import {
  buildOtpAuthUrl,
  decryptSecretFromStorage,
  encryptSecretForStorage,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  normalizeRecoveryCode,
  parseTokenTimeToDate,
  verifyTotpCode,
} from '../../infrastructure/auth/MfaService';
import { checkTermsAcceptance } from '../middleware/termsEnforcement';

type TokenPayload = {
  sub: string;
  jti?: string;
  sid?: string;
  tid?: number;
  exp: number;
};

const SUPERADMIN_EMAIL = 'seanhogg@gmail.com';

function canUseSuperAdmin(user: Pick<typeof users.$inferSelect, 'email' | 'isSuperadmin'>): boolean {
  return user.isSuperadmin && normalizeEmail(user.email) === SUPERADMIN_EMAIL;
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

function toUserResponse(user: typeof users.$inferSelect) {
  const superadmin = canUseSuperAdmin(user);
  return {
    id: user.id,
    email: user.email,
    username: user.username ?? '',
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
    isSuperadmin: superadmin,
    mfaEnabled: user.mfaEnabled,
  };
}

function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

type LegalDocResponse = {
  documentType: 'terms' | 'privacy';
  version: string;
  title: string;
  content: string;
  publishedAt: string;
};

const DEFAULT_LEGAL: Record<'terms' | 'privacy', Omit<LegalDocResponse, 'documentType'>> = {
  terms: {
    version: '1.0.0',
    title: 'Terms of Use',
    content: 'By using CoderClawLink, you agree to these Terms of Use. Continued use of the service indicates acceptance of current terms.',
    publishedAt: new Date(0).toISOString(),
  },
  privacy: {
    version: '1.0.0',
    title: 'Privacy Policy',
    content: 'CoderClawLink processes account, usage, and operational metadata to provide and secure the service.',
    publishedAt: new Date(0).toISOString(),
  },
};

async function getActiveLegalDoc(db: Db, documentType: 'terms' | 'privacy'): Promise<LegalDocResponse> {
  const [doc] = await db
    .select({
      version: legalDocuments.version,
      title: legalDocuments.title,
      content: legalDocuments.content,
      publishedAt: legalDocuments.publishedAt,
    })
    .from(legalDocuments)
    .where(and(eq(legalDocuments.documentType, documentType), eq(legalDocuments.isActive, true)))
    .orderBy(desc(legalDocuments.publishedAt))
    .limit(1);

  if (!doc) {
    return {
      documentType,
      ...DEFAULT_LEGAL[documentType],
    };
  }

  return {
    documentType,
    version: doc.version,
    title: doc.title,
    content: doc.content,
    publishedAt: doc.publishedAt ? doc.publishedAt.toISOString() : new Date().toISOString(),
  };
}

async function ensureSession(
  db: Db,
  opts: {
    sessionId: string;
    userId: string;
    sessionName?: string | null;
    userAgent?: string | null;
    ipAddress?: string | null;
  },
) {
  const [existing] = await db
    .select({ id: authUserSessions.id })
    .from(authUserSessions)
    .where(eq(authUserSessions.id, opts.sessionId))
    .limit(1);

  if (existing) {
    await db
      .update(authUserSessions)
      .set({
        sessionName: opts.sessionName ?? undefined,
        userAgent: opts.userAgent ?? undefined,
        ipAddress: opts.ipAddress ?? undefined,
        isActive: true,
        revokedAt: null,
        lastSeenAt: sql`now()`,
      })
      .where(eq(authUserSessions.id, opts.sessionId));
    return;
  }

  await db.insert(authUserSessions).values({
    id: opts.sessionId,
    userId: opts.userId,
    sessionName: opts.sessionName ?? null,
    userAgent: opts.userAgent ?? null,
    ipAddress: opts.ipAddress ?? null,
  });
}

async function persistToken(
  db: Db,
  token: string,
  opts: {
    userId: string;
    tenantId?: number;
    tokenType: 'web' | 'tenant';
    sessionName?: string | null;
    userAgent?: string | null;
    ipAddress?: string | null;
    fallbackSessionId?: string;
  },
) {
  const payload = decodeJwtPayload<TokenPayload>(token);
  if (!payload.jti) return;

  const sessionId = payload.sid ?? opts.fallbackSessionId;
  if (sessionId) {
    await ensureSession(db, {
      sessionId,
      userId: opts.userId,
      sessionName: opts.sessionName,
      userAgent: opts.userAgent,
      ipAddress: opts.ipAddress,
    });
  }

  await db.insert(authTokens).values({
    jti: payload.jti,
    userId: opts.userId,
    sessionId: sessionId ?? null,
    tenantId: opts.tenantId ?? null,
    tokenType: opts.tokenType,
    issuedAt: new Date(),
    expiresAt: parseTokenTimeToDate(payload.exp),
    userAgent: opts.userAgent ?? null,
    ipAddress: opts.ipAddress ?? null,
  });
}

async function assertMfa(
  db: Db,
  envSecret: string,
  user: typeof users.$inferSelect,
  code?: string,
  recoveryCode?: string,
): Promise<boolean> {
  if (!user.mfaEnabled || !user.mfaSecretEnc) return false;

  if (code) {
    const secret = await decryptSecretFromStorage(user.mfaSecretEnc, envSecret);
    const validTotp = await verifyTotpCode(secret, code);
    if (validTotp) return true;
  }

  if (recoveryCode) {
    const normalized = normalizeRecoveryCode(recoveryCode);
    const hash = await hashRecoveryCode(normalized);
    const [stored] = await db
      .select({ id: userMfaRecoveryCodes.id })
      .from(userMfaRecoveryCodes)
      .where(
        and(
          eq(userMfaRecoveryCodes.userId, user.id),
          eq(userMfaRecoveryCodes.codeHash, hash),
          isNull(userMfaRecoveryCodes.usedAt),
        ),
      )
      .limit(1);

    if (stored) {
      await db
        .update(userMfaRecoveryCodes)
        .set({ usedAt: sql`now()` })
        .where(eq(userMfaRecoveryCodes.id, stored.id));
      return true;
    }
  }

  return false;
}

async function replaceRecoveryCodes(db: Db, userId: string, codes: string[]) {
  await db.delete(userMfaRecoveryCodes).where(eq(userMfaRecoveryCodes.userId, userId));
  const hashed = await Promise.all(
    codes.map(async (code) => ({
      userId,
      codeHash: await hashRecoveryCode(code),
    })),
  );
  await db.insert(userMfaRecoveryCodes).values(hashed);
}

/**
 * Auth routes – no auth middleware on the entry points.
 *
 * API-key flow (SDK / CLI):
 *   POST /api/auth/register  – create user + get API key (one-time)
 *   POST /api/auth/token     – exchange API key + tenantId for JWT (backward compat / claw auth)
 *
 * Web / marketplace flow (email + password):
 *   POST /api/auth/web/register   – create account, returns WebJWT + user
 *   POST /api/auth/web/login      – verify password, returns WebJWT + user
 *   GET  /api/auth/my-tenants     – list tenants the caller belongs to (WebJWT required)
 *   POST /api/auth/tenant-token   – exchange WebJWT + tenantId for tenant-scoped JWT
 *   GET  /api/auth/me             – return caller's profile (WebJWT required)
 */
export function createAuthRoutes(authService: AuthService, db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // POST /api/auth/newsletter/subscribers
  // Public endpoint used by marketing surfaces for subscribe/unsubscribe.
  router.post('/newsletter/subscribers', async (c) => {
    const body = await c.req.json<{
      email?: string;
      action?: 'subscribe' | 'unsubscribe';
      source?: string;
      firstName?: string;
      lastName?: string;
      reason?: string;
    }>();

    const rawEmail = body.email ?? '';
    const email = normalizeEmail(rawEmail);
    if (!email || !email.includes('@')) {
      return c.json({ error: 'Valid email is required' }, 400);
    }

    const action = body.action === 'unsubscribe' ? 'unsubscribe' : 'subscribe';
    const source = body.source?.trim() || 'marketing_site';
    const firstName = body.firstName?.trim() || null;
    const lastName = body.lastName?.trim() || null;
    const reason = body.reason?.trim() || null;

    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    const [existing] = await db
      .select({ id: newsletterSubscribers.id })
      .from(newsletterSubscribers)
      .where(eq(newsletterSubscribers.email, email))
      .limit(1);

    let subscriberId: number;

    if (action === 'subscribe') {
      if (existing) {
        const [updated] = await db
          .update(newsletterSubscribers)
          .set({
            userId: user?.id ?? null,
            firstName,
            lastName,
            source,
            status: 'subscribed',
            unsubscribedAt: null,
            unsubscribeReason: null,
            updatedAt: sql`now()`,
          })
          .where(eq(newsletterSubscribers.id, existing.id))
          .returning({ id: newsletterSubscribers.id });
        subscriberId = updated!.id;
      } else {
        const [created] = await db
          .insert(newsletterSubscribers)
          .values({
            userId: user?.id ?? null,
            email,
            firstName,
            lastName,
            source,
            status: 'subscribed',
          })
          .returning({ id: newsletterSubscribers.id });
        subscriberId = created!.id;
      }

      await db.insert(newsletterEvents).values({
        subscriberId,
        eventType: 'subscribed',
        metadata: JSON.stringify({ source }),
      });

      return c.json({ ok: true, email, status: 'subscribed', subscribed: true });
    }

    if (existing) {
      const [updated] = await db
        .update(newsletterSubscribers)
        .set({
          status: 'unsubscribed',
          unsubscribedAt: sql`now()`,
          unsubscribeReason: reason,
          updatedAt: sql`now()`,
        })
        .where(eq(newsletterSubscribers.id, existing.id))
        .returning({ id: newsletterSubscribers.id });
      subscriberId = updated!.id;
    } else {
      const [created] = await db
        .insert(newsletterSubscribers)
        .values({
          userId: user?.id ?? null,
          email,
          source,
          status: 'unsubscribed',
          unsubscribedAt: new Date(),
          unsubscribeReason: reason,
        })
        .returning({ id: newsletterSubscribers.id });
      subscriberId = created!.id;
    }

    await db.insert(newsletterEvents).values({
      subscriberId,
      eventType: 'unsubscribed',
      metadata: JSON.stringify({ source, reason }),
    });

    return c.json({ ok: true, email, status: 'unsubscribed', subscribed: false });
  });

  // POST /api/auth/privacy-requests
  // Public endpoint for CCPA/GDPR information requests from marketing/legal pages.
  router.post('/privacy-requests', async (c) => {
    const body = await c.req.json<{
      email?: string;
      requestType?: 'ccpa' | 'gdpr';
      details?: string;
    }>();

    const rawEmail = body.email ?? '';
    const email = normalizeEmail(rawEmail);
    if (!email || !email.includes('@')) {
      return c.json({ error: 'Valid email is required' }, 400);
    }

    const requestType = body.requestType === 'gdpr' ? 'gdpr' : 'ccpa';
    const details = body.details?.trim() || null;

    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    const [created] = await db
      .insert(privacyRequests)
      .values({
        userId: user?.id ?? null,
        email,
        requestType,
        details,
      })
      .returning({ id: privacyRequests.id });

    if (!created) {
      return c.json({ error: 'Failed to create privacy request' }, 500);
    }

    return c.json({ ok: true, id: created.id });
  });

  // GET /api/auth/legal/current
  router.get('/legal/current', async (c) => {
    const [terms, privacy] = await Promise.all([
      getActiveLegalDoc(db, 'terms'),
      getActiveLegalDoc(db, 'privacy'),
    ]);
    return c.json({ terms, privacy });
  });

  // GET /api/auth/legal/terms/status (requires WebJWT)
  router.get('/legal/terms/status', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const terms = await getActiveLegalDoc(db, 'terms');
    const status = await checkTermsAcceptance(db, userId);
    return c.json({
      requiredVersion: status.requiredVersion ?? terms.version,
      acceptedVersion: status.acceptedVersion,
      needsAcceptance: status.needsAcceptance,
      terms,
    });
  });

  // POST /api/auth/legal/terms/accept (requires WebJWT)
  router.post('/legal/terms/accept', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const body = await c.req.json<{ version?: string }>();

    const terms = await getActiveLegalDoc(db, 'terms');
    if (body.version && body.version !== terms.version) {
      return c.json({ error: `Active terms version is ${terms.version}` }, 409);
    }

    await db
      .insert(userLegalAcceptances)
      .values({
        userId,
        documentType: 'terms',
        version: terms.version,
      })
      .onConflictDoUpdate({
        target: [userLegalAcceptances.userId, userLegalAcceptances.documentType],
        set: {
          version: terms.version,
          acceptedAt: sql`now()`,
          updatedAt: sql`now()`,
        },
      });

    return c.json({
      acceptedVersion: terms.version,
      acceptedAt: new Date().toISOString(),
      terms,
    });
  });

  // POST /api/auth/register
  router.post('/register', async (c) => {
    const body = await c.req.json<{ email: string; tenantId: number }>();
    const result = await authService.register(body);
    return c.json({
      user:   result.user,
      apiKey: result.apiKey,
      note:   'Save your API key – it will not be shown again.',
    }, 201);
  });

  // POST /api/auth/token
  router.post('/token', async (c) => {
    const body = await c.req.json<{ apiKey: string; tenantId: number }>();
    const result = await authService.login(body.apiKey, body.tenantId);
    return c.json({ token: result.token, expiresIn: result.expiresIn });
  });

  // -------------------------------------------------------------------------
  // Web / marketplace auth
  // -------------------------------------------------------------------------

  // POST /api/auth/web/register
  router.post('/web/register', async (c) => {
    const body = await c.req.json<{ email: string; username?: string; password: string }>();
    if (!body.email || !body.password) {
      return c.json({ error: 'email and password are required' }, 400);
    }

    const email = body.email.toLowerCase().trim();
    const username = (body.username && body.username.trim())
      ? body.username.toLowerCase().trim()
      : email;
    if (!email.includes('@')) return c.json({ error: 'Invalid email address' }, 400);
    if (body.password.length < 8) return c.json({ error: 'Password must be at least 8 characters' }, 400);

    const [existingEmail] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (existingEmail) return c.json({ error: 'Email already registered' }, 409);

    const [existingUsername] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, username))
      .limit(1);
    if (existingUsername) return c.json({ error: 'Username already taken' }, 409);

    const passwordHash = await hashPassword(body.password);
    const apiKeyHash = await hashSecret(crypto.randomUUID());
    const userId = crypto.randomUUID();

    const [created] = await db
      .insert(users)
      .values({
        id: userId,
        email,
        username,
        displayName: username,
        passwordHash,
        apiKeyHash,
      })
      .returning();

    if (!created) return c.json({ error: 'Failed to create user' }, 500);

    const sessionName = 'Current device';
    const userAgent = getUserAgent(c);
    const ipAddress = getClientIp(c);

    const token = await signWebJwt(
      {
        sub: created.id,
        email: created.email,
        username: created.username ?? '',
        mfa: false,
        amr: ['pwd'],
      },
      c.env.JWT_SECRET,
      86_400,
    );

    await persistToken(db, token, {
      userId: created.id,
      tokenType: 'web',
      sessionName,
      userAgent,
      ipAddress,
    });

    return c.json({
      token,
      expiresIn: 86_400,
      user: toUserResponse(created),
      mfaRequired: false,
    }, 201);
  });

  // POST /api/auth/web/login
  router.post('/web/login', async (c) => {
    const body = await c.req.json<{ email: string; password: string; sessionName?: string }>();
    if (!body.email || !body.password) {
      return c.json({ error: 'email and password are required' }, 400);
    }

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, body.email.toLowerCase().trim()))
      .limit(1);

    if (!user || !user.passwordHash) {
      return c.json({ error: 'Invalid email or password' }, 401);
    }

    const ok = await verifyPassword(body.password, user.passwordHash);
    if (!ok) {
      return c.json({ error: 'Invalid email or password' }, 401);
    }

    if (user.mfaEnabled) {
      const superadmin = canUseSuperAdmin(user);
      const mfaToken = await signWebJwt(
        {
          sub: user.id,
          email: user.email,
          username: user.username ?? '',
          sa: superadmin ? true : undefined,
          mfaPending: true,
          amr: ['pwd'],
        },
        c.env.JWT_SECRET,
        300,
      );

      return c.json({
        mfaRequired: true,
        mfaToken,
        expiresIn: 300,
        user: toUserResponse(user),
        methods: ['totp', 'recovery_code'],
      });
    }

    const superadmin = canUseSuperAdmin(user);
    const token = await signWebJwt(
      {
        sub: user.id,
        email: user.email,
        username: user.username ?? '',
        sa: superadmin ? true : undefined,
        mfa: false,
        amr: ['pwd'],
      },
      c.env.JWT_SECRET,
      86_400,
    );

    await persistToken(db, token, {
      userId: user.id,
      tokenType: 'web',
      sessionName: body.sessionName ?? 'Current device',
      userAgent: getUserAgent(c),
      ipAddress: getClientIp(c),
    });

    return c.json({
      token,
      expiresIn: 86_400,
      user: toUserResponse(user),
      mfaRequired: false,
    });
  });

  // POST /api/auth/web/login/mfa
  router.post('/web/login/mfa', async (c) => {
    const body = await c.req.json<{
      mfaToken: string;
      code?: string;
      recoveryCode?: string;
      sessionName?: string;
    }>();

    if (!body.mfaToken) return c.json({ error: 'mfaToken is required' }, 400);
    if (!body.code && !body.recoveryCode) {
      return c.json({ error: 'A TOTP code or recovery code is required' }, 400);
    }

    let pending;
    try {
      pending = await verifyWebJwt(body.mfaToken, c.env.JWT_SECRET);
    } catch {
      return c.json({ error: 'Invalid or expired MFA token' }, 401);
    }

    if (!pending.mfaPending) return c.json({ error: 'Invalid MFA token state' }, 401);

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, pending.sub))
      .limit(1);

    if (!user || !user.mfaEnabled || !user.mfaSecretEnc) {
      return c.json({ error: 'MFA is not enabled for this account' }, 400);
    }

    const valid = await assertMfa(db, c.env.JWT_SECRET, user, body.code, body.recoveryCode);
    if (!valid) return c.json({ error: 'Invalid MFA code' }, 401);

    const superadmin = canUseSuperAdmin(user);
    const token = await signWebJwt(
      {
        sub: user.id,
        email: user.email,
        username: user.username ?? '',
        sa: superadmin ? true : undefined,
        mfa: true,
        amr: ['pwd', 'mfa'],
      },
      c.env.JWT_SECRET,
      86_400,
    );

    await db
      .update(users)
      .set({ mfaLastVerifiedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(users.id, user.id));

    await persistToken(db, token, {
      userId: user.id,
      tokenType: 'web',
      sessionName: body.sessionName ?? 'Current device',
      userAgent: getUserAgent(c),
      ipAddress: getClientIp(c),
    });

    return c.json({
      token,
      expiresIn: 86_400,
      user: toUserResponse(user),
      mfaRequired: false,
    });
  });

  // GET /api/auth/me  (requires WebJWT)
  router.get('/me', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as UserId;
    const user = await authService.getMe(userId);
    if (!user) return c.json({ error: 'User not found' }, 404);
    const [full] = await db
      .select({ mfaEnabled: users.mfaEnabled })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return c.json({ user: { ...user, mfaEnabled: full?.mfaEnabled ?? false } });
  });

  // POST /api/auth/claw-token – a CoderClaw instance authenticates with its API key
  // Returns a tenant-scoped JWT so the claw can call all tenant APIs.
  router.post('/claw-token', async (c) => {
    const body = await c.req.json<{ apiKey: string }>();
    if (!body.apiKey) return c.json({ error: 'apiKey is required' }, 400);

    const keyHash = await hashSecret(body.apiKey);
    const [claw] = await db
      .select()
      .from(coderclawInstances)
      .where(eq(coderclawInstances.apiKeyHash, keyHash))
      .limit(1);

    if (!claw || claw.status !== 'active') {
      return c.json({ error: 'Invalid or inactive API key' }, 401);
    }

    const expiresIn = 3600;
    const token = await signJwt(
      { sub: `claw:${claw.id}`, tid: claw.tenantId, role: TenantRole.DEVELOPER },
      c.env.JWT_SECRET,
      expiresIn,
    );
    return c.json({ token, expiresIn, clawId: claw.id, tenantId: claw.tenantId });
  });

  // GET /api/auth/my-tenants  (requires WebJWT)
  router.get('/my-tenants', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const result = await authService.myTenants(userId);
    return c.json(result);
  });

  // POST /api/auth/tenant-token  (requires WebJWT + body: { tenantId })
  router.post('/tenant-token', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const body = await c.req.json<{ tenantId: number }>();
    if (!body.tenantId) return c.json({ error: 'tenantId is required' }, 400);

    const sessionId = c.get('sessionId') as string | undefined;
    const result = await authService.tenantToken(userId, body.tenantId, sessionId);

    await persistToken(db, result.token, {
      userId,
      tenantId: body.tenantId,
      tokenType: 'tenant',
      fallbackSessionId: sessionId,
      sessionName: 'Workspace token',
      userAgent: getUserAgent(c),
      ipAddress: getClientIp(c),
    });

    return c.json(result);
  });

  // GET /api/auth/mfa/status
  router.get('/mfa/status', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const [user] = await db
      .select({
        mfaEnabled: users.mfaEnabled,
        mfaTempExpiresAt: users.mfaTempExpiresAt,
        mfaEnabledAt: users.mfaEnabledAt,
        mfaRecoveryGeneratedAt: users.mfaRecoveryGeneratedAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) return c.json({ error: 'User not found' }, 404);

    return c.json({
      enabled: user.mfaEnabled,
      setupPending: Boolean(user.mfaTempExpiresAt && user.mfaTempExpiresAt > new Date()),
      enabledAt: user.mfaEnabledAt,
      recoveryGeneratedAt: user.mfaRecoveryGeneratedAt,
    });
  });

  // POST /api/auth/mfa/setup
  router.post('/mfa/setup', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const [user] = await db
      .select({ id: users.id, email: users.email, mfaEnabled: users.mfaEnabled })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) return c.json({ error: 'User not found' }, 404);
    if (user.mfaEnabled) return c.json({ error: 'MFA is already enabled' }, 409);

    const secret = generateTotpSecret();
    const encrypted = await encryptSecretForStorage(secret, c.env.JWT_SECRET);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await db
      .update(users)
      .set({
        mfaTempSecretEnc: encrypted,
        mfaTempExpiresAt: expiresAt,
        updatedAt: sql`now()`,
      })
      .where(eq(users.id, user.id));

    const otpauthUrl = buildOtpAuthUrl({
      accountName: user.email,
      secret,
      issuer: 'CoderClawLink',
    });

    return c.json({
      otpauthUrl,
      manualEntryKey: secret,
      expiresIn: 600,
    });
  });

  // POST /api/auth/mfa/enable
  router.post('/mfa/enable', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const body = await c.req.json<{ code: string }>();
    if (!body.code) return c.json({ error: 'code is required' }, 400);

    const [user] = await db
      .select({
        id: users.id,
        mfaEnabled: users.mfaEnabled,
        mfaTempSecretEnc: users.mfaTempSecretEnc,
        mfaTempExpiresAt: users.mfaTempExpiresAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) return c.json({ error: 'User not found' }, 404);
    if (user.mfaEnabled) return c.json({ error: 'MFA is already enabled' }, 409);
    if (!user.mfaTempSecretEnc || !user.mfaTempExpiresAt || user.mfaTempExpiresAt <= new Date()) {
      return c.json({ error: 'MFA setup session expired. Start setup again.' }, 400);
    }

    const secret = await decryptSecretFromStorage(user.mfaTempSecretEnc, c.env.JWT_SECRET);
    const valid = await verifyTotpCode(secret, body.code);
    if (!valid) return c.json({ error: 'Invalid MFA code' }, 401);

    const encryptedSecret = await encryptSecretForStorage(secret, c.env.JWT_SECRET);
    const recoveryCodes = generateRecoveryCodes(10);

    await replaceRecoveryCodes(db, user.id, recoveryCodes);

    await db
      .update(users)
      .set({
        mfaEnabled: true,
        mfaSecretEnc: encryptedSecret,
        mfaEnabledAt: sql`now()`,
        mfaTempSecretEnc: null,
        mfaTempExpiresAt: null,
        mfaRecoveryGeneratedAt: sql`now()`,
        mfaLastVerifiedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(users.id, user.id));

    return c.json({ enabled: true, recoveryCodes });
  });

  // POST /api/auth/mfa/disable
  router.post('/mfa/disable', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const body = await c.req.json<{ code?: string; recoveryCode?: string }>();
    if (!body.code && !body.recoveryCode) {
      return c.json({ error: 'A TOTP code or recovery code is required' }, 400);
    }

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) return c.json({ error: 'User not found' }, 404);
    if (!user.mfaEnabled) return c.json({ enabled: false });

    const valid = await assertMfa(db, c.env.JWT_SECRET, user, body.code, body.recoveryCode);
    if (!valid) return c.json({ error: 'Invalid MFA code' }, 401);

    await db.delete(userMfaRecoveryCodes).where(eq(userMfaRecoveryCodes.userId, user.id));
    await db
      .update(users)
      .set({
        mfaEnabled: false,
        mfaSecretEnc: null,
        mfaTempSecretEnc: null,
        mfaTempExpiresAt: null,
        mfaEnabledAt: null,
        mfaRecoveryGeneratedAt: null,
        updatedAt: sql`now()`,
      })
      .where(eq(users.id, user.id));

    return c.json({ enabled: false });
  });

  // POST /api/auth/mfa/recovery-codes/regenerate
  router.post('/mfa/recovery-codes/regenerate', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const body = await c.req.json<{ code?: string; recoveryCode?: string }>();
    if (!body.code && !body.recoveryCode) {
      return c.json({ error: 'A TOTP code or recovery code is required' }, 400);
    }

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) return c.json({ error: 'User not found' }, 404);
    if (!user.mfaEnabled) return c.json({ error: 'MFA is not enabled' }, 400);

    const valid = await assertMfa(db, c.env.JWT_SECRET, user, body.code, body.recoveryCode);
    if (!valid) return c.json({ error: 'Invalid MFA code' }, 401);

    const recoveryCodes = generateRecoveryCodes(10);
    await replaceRecoveryCodes(db, user.id, recoveryCodes);
    await db
      .update(users)
      .set({ mfaRecoveryGeneratedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(users.id, user.id));

    return c.json({ recoveryCodes });
  });

  // GET /api/auth/sessions
  router.get('/sessions', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const currentSessionId = c.get('sessionId') as string | undefined;

    const sessions = await db
      .select()
      .from(authUserSessions)
      .where(eq(authUserSessions.userId, userId))
      .orderBy(desc(authUserSessions.lastSeenAt));

    const sessionIds = sessions.map((session) => session.id);
    const tokenRows = sessionIds.length
      ? await db
        .select({
          sessionId: authTokens.sessionId,
          activeCount: sql<number>`COUNT(*)`,
        })
        .from(authTokens)
        .where(
          and(
            eq(authTokens.userId, userId),
            inArray(authTokens.sessionId, sessionIds),
            isNull(authTokens.revokedAt),
            gt(authTokens.expiresAt, new Date()),
          ),
        )
        .groupBy(authTokens.sessionId)
      : [];

    const activeBySession = new Map<string, number>();
    for (const row of tokenRows) {
      if (!row.sessionId) continue;
      activeBySession.set(row.sessionId, Number(row.activeCount));
    }

    return c.json({
      sessions: sessions.map((session) => ({
        id: session.id,
        sessionName: session.sessionName,
        userAgent: session.userAgent,
        ipAddress: session.ipAddress,
        isActive: session.isActive,
        revokedAt: session.revokedAt,
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt,
        activeTokens: activeBySession.get(session.id) ?? 0,
        isCurrent: currentSessionId === session.id,
      })),
    });
  });

  // POST /api/auth/sessions/:sessionId/revoke
  router.post('/sessions/:sessionId/revoke', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const sessionId = c.req.param('sessionId');
    if (!sessionId) return c.json({ error: 'sessionId is required' }, 400);

    await db
      .update(authUserSessions)
      .set({ isActive: false, revokedAt: sql`now()`, lastSeenAt: sql`now()` })
      .where(and(eq(authUserSessions.id, sessionId), eq(authUserSessions.userId, userId)));

    await db
      .update(authTokens)
      .set({ revokedAt: sql`now()`, lastSeenAt: sql`now()` })
      .where(
        and(
          eq(authTokens.userId, userId),
          eq(authTokens.sessionId, sessionId),
          isNull(authTokens.revokedAt),
        ),
      );

    return c.json({ ok: true });
  });

  // POST /api/auth/sessions/revoke-others
  router.post('/sessions/revoke-others', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const currentSessionId = c.get('sessionId') as string | undefined;
    if (!currentSessionId) return c.json({ error: 'Current session is not identifiable' }, 400);

    await db
      .update(authUserSessions)
      .set({ isActive: false, revokedAt: sql`now()`, lastSeenAt: sql`now()` })
      .where(
        and(
          eq(authUserSessions.userId, userId),
          ne(authUserSessions.id, currentSessionId),
          eq(authUserSessions.isActive, true),
        ),
      );

    await db
      .update(authTokens)
      .set({ revokedAt: sql`now()`, lastSeenAt: sql`now()` })
      .where(
        and(
          eq(authTokens.userId, userId),
          ne(authTokens.sessionId, currentSessionId),
          isNull(authTokens.revokedAt),
        ),
      );

    return c.json({ ok: true });
  });

  // GET /api/auth/tokens
  router.get('/tokens', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const currentJti = c.get('tokenJti') as string | undefined;

    const rows = await db
      .select({
        jti: authTokens.jti,
        tokenType: authTokens.tokenType,
        tenantId: authTokens.tenantId,
        sessionId: authTokens.sessionId,
        issuedAt: authTokens.issuedAt,
        expiresAt: authTokens.expiresAt,
        revokedAt: authTokens.revokedAt,
        userAgent: authTokens.userAgent,
        ipAddress: authTokens.ipAddress,
        lastSeenAt: authTokens.lastSeenAt,
      })
      .from(authTokens)
      .where(eq(authTokens.userId, userId))
      .orderBy(desc(authTokens.lastSeenAt));

    return c.json({
      tokens: rows.map((row) => ({
        ...row,
        isCurrent: currentJti === row.jti,
        isActive: !row.revokedAt && row.expiresAt > new Date(),
      })),
    });
  });

  // POST /api/auth/tokens/:jti/revoke
  router.post('/tokens/:jti/revoke', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const jti = c.req.param('jti');
    if (!jti) return c.json({ error: 'jti is required' }, 400);

    await db
      .update(authTokens)
      .set({ revokedAt: sql`now()`, lastSeenAt: sql`now()` })
      .where(and(eq(authTokens.jti, jti), eq(authTokens.userId, userId), isNull(authTokens.revokedAt)));

    return c.json({ ok: true });
  });

  return router;
}
