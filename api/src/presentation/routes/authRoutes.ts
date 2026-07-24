import { Hono, type Context } from 'hono';
import { and, desc, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm';
import { AuthService } from '../../application/auth/AuthService';
import { DeviceAuthService } from '../../application/auth/DeviceAuthService';
import { resolveAppBaseUrl, type Env, type HonoEnv } from '../../env';
import { credentialSecret } from '../../application/integrations/credentialCrypto';
import { sendWelcomeEmail, sendAccountTypeSelectedEmail } from '../../infrastructure/email/EmailService';
import { sendTransactionalEmail } from '../../application/email/sendEmail';
import { headerHints, rememberUserLocale } from '../../application/email/emailLocaleResolver';
import { localeFromHeaders } from '../../infrastructure/email/emailLocale';
import { webAuthMiddleware } from '../middleware/webAuthMiddleware';
import { TenantRole, type UserId } from '../../domain/shared/types';
import {
  adminImpersonationSessions,
  authTokens,
  authUserSessions,
  agentHosts,
  newsletterEvents,
  newsletterSubscribers,
  privacyRequests,
  tenants,
  userLegalAcceptances,
  userMfaRecoveryCodes,
  users,
  tenantApiKeys,
  tenantMembers,
} from '../../infrastructure/database/schema';
import { hashPassword, hashSecret, verifyPassword } from '../../infrastructure/auth/HashService';
import { decodeJwtPayload, signJwt, signWebJwt, verifyWebJwt } from '../../infrastructure/auth/JwtService';
import { mintTenantSessionToken } from '../../infrastructure/auth/tenantSessionToken';
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
import { revokeTenantApiKeyByRawKey } from '../../application/llm/tenantApiKeyService';
import { issueVerificationCode, verifyVerificationCode, type VerifyResult } from '../../application/auth/EmailVerificationService';
import { checkTermsAcceptance } from '../middleware/termsEnforcement';
import { getActiveLegalDoc } from '../../application/legal/legalDocsService';
import { sanitizePsychometricProfile } from '../../application/persona/psychometricCatalog';
import { provisionForHireProfile } from '../../application/freelance/provisionForHire';
import { invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { assigneeProfilesCacheKey } from '../../application/kanban/assigneeProfiles';

/** Parse a stored psychometric JSON column into an object (null when unset/invalid). */
function parsePsychometric(raw: string | null | undefined): unknown {
  if (!raw) return null;
  try { return JSON.parse(raw) as unknown; } catch { return null; }
}

/** Resumable setup-wizard progress, recorded by STEP ID (see migration 0343). */
export interface OnboardingProgress {
  track: 'builder' | 'hired';
  completed: string[];
  activeStep: string | null;
}

const ONBOARDING_TRACKS = ['builder', 'hired'] as const;

/** Parse + validate stored progress; anything malformed degrades to null so a bad
 *  row can never break the wizard (it just restarts at step 1). */
export function parseOnboardingProgress(raw: string | null | undefined): OnboardingProgress | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<OnboardingProgress>;
    if (!ONBOARDING_TRACKS.includes(v.track as (typeof ONBOARDING_TRACKS)[number])) return null;
    return {
      track: v.track as OnboardingProgress['track'],
      completed: Array.isArray(v.completed) ? v.completed.filter((s): s is string => typeof s === 'string').slice(0, 32) : [],
      activeStep: typeof v.activeStep === 'string' ? v.activeStep : null,
    };
  } catch {
    return null;
  }
}

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
    // This human's OWN personality (same PsychometricProfile shape agents/personas use).
    psychometric: parsePsychometric(user.psychometric),
    isSuperadmin: superadmin,
    // 'standard' | 'freelancer' — drives the restricted gig shell on the client.
    accountType: user.accountType ?? 'standard',
    // True once the user has EXPLICITLY picked Build vs Hired. False for an
    // OAuth/magic-link account that hasn't chosen — the gate forces the choice.
    accountTypeSelected: !!user.accountTypeSelectedAt,
    // Opt-in to being hired talent (a builder can also be for-hire). Drives the
    // for-hire nav destinations + Settings toggle on the client.
    availableForHire: user.availableForHire ?? false,
    mfaEnabled: user.mfaEnabled,
  };
}

/**
 * Give a freelancer account its for-hire profile stub — a private, unpublished
 * profile plus a hired.video job-seeker provisioning (native résumé path when the
 * partner SDK isn't configured). Idempotent. Shared by the password-register path
 * and the post-OAuth role chooser (and, via provisionForHireProfile, by a standard
 * builder opting in) so the row shape never drifts.
 */
async function provisionFreelancer(
  c: Context<HonoEnv>,
  user: typeof users.$inferSelect,
): Promise<void> {
  await provisionForHireProfile(c.env, {
    id: user.id,
    email: user.email,
    name: user.displayName ?? user.username ?? undefined,
  });
}

function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
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
  env: Env,
  user: typeof users.$inferSelect,
  code?: string,
  recoveryCode?: string,
): Promise<boolean> {
  if (!user.mfaEnabled || !user.mfaSecretEnc) return false;

  if (code) {
    // M2: read under the dedicated credential secret, JWT_SECRET as legacy fallback
    // (versioned dual-read) so pre-migration MFA rows still decrypt.
    const secret = await decryptSecretFromStorage(user.mfaSecretEnc, credentialSecret(env), { legacySecret: env.JWT_SECRET });
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
 *   POST /api/auth/token     – exchange API key + tenantId for JWT (backward compat / agentHost auth)
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
  // Device-code (RFC 8628) sign-in for editor clients (VS Code extension)
  // -------------------------------------------------------------------------
  const deviceAuth = new DeviceAuthService(db);

  // POST /api/auth/device/code — public; start a device login.
  router.post('/device/code', async (c) => {
    const body = await c.req.json<{ client?: string }>().catch(() => ({} as { client?: string }));
    const appUrl = c.env.APP_URL || 'https://builderforce.ai';
    const start = await deviceAuth.start(appUrl, body.client);
    return c.json(start);
  });

  // POST /api/auth/device/approve — WebJWT; called by the /activate page.
  router.post('/device/approve', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const body = await c.req.json<{
      userCode?: string;
      user_code?: string;
      tenantId?: number;
      decision?: 'approve' | 'deny';
    }>();
    const userCode = (body.userCode ?? body.user_code ?? '').trim();
    if (!userCode) return c.json({ error: 'user_code is required' }, 400);

    if (body.decision === 'deny') {
      await deviceAuth.deny(userCode);
      return c.json({ ok: true, decision: 'deny' });
    }

    const res = await deviceAuth.approve({
      userCode,
      userId,
      tenantId: body.tenantId,
      envSecret: credentialSecret(c.env),
    });
    if (!res.ok) return c.json({ error: res.error }, res.error === 'no_tenant' ? 409 : 400);
    return c.json({ ok: true, decision: 'approve' });
  });

  // POST /api/auth/editor-key — WebJWT; mint a personal editor key (copy-button flow).
  // Not owner-gated: it's the signed-in member's own editor credential.
  router.post('/editor-key', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as string;
    const body = await c.req
      .json<{ tenantId?: number }>()
      .catch(() => ({} as { tenantId?: number }));
    const res = await deviceAuth.mintEditorKey({ userId, tenantId: body.tenantId });
    if (!res.ok) return c.json({ error: res.error }, res.error === 'no_tenant' ? 409 : 400);
    return c.json({ access_key: res.key, tenant_id: res.tenantId, token_type: 'bearer' });
  });

  // POST /api/auth/device/token — public; polled by the extension.
  router.post('/device/token', async (c) => {
    const body = await c.req.json<{ device_code?: string }>();
    if (!body.device_code) return c.json({ error: 'device_code is required' }, 400);
    const res = await deviceAuth.poll(body.device_code, credentialSecret(c.env), c.env.JWT_SECRET);
    switch (res.state) {
      case 'approved':
        return c.json({ access_key: res.accessKey, tenant_id: res.tenantId, token_type: 'bearer' }, 200);
      case 'pending':
        return c.json({ error: 'authorization_pending' }, 428);
      case 'slow_down':
        return c.json({ error: 'slow_down' }, 429);
      case 'denied':
        return c.json({ error: 'access_denied' }, 403);
      case 'expired':
        return c.json({ error: 'expired_token' }, 410);
    }
  });

  // POST /api/auth/keys/revoke — self-service revoke of an editor key (bfk_*) by
  // presenting the raw key. Possession of the key authorizes its own revocation,
  // so no JWT is required. Editor clients (VS Code) call this on sign-out so the
  // server-side key dies with the local session instead of being orphaned.
  // Idempotent: unknown / malformed / already-revoked keys return { revoked: false }
  // with 200, never leaking whether the key existed.
  router.post('/keys/revoke', async (c) => {
    const body = await c.req
      .json<{ apiKey?: string; key?: string }>()
      .catch(() => ({} as { apiKey?: string; key?: string }));
    const rawKey = (body.apiKey ?? body.key ?? '').trim();
    if (!rawKey) return c.json({ error: 'apiKey is required' }, 400);
    const revoked = await revokeTenantApiKeyByRawKey(db, { rawKey, env: c.env });
    return c.json({ revoked });
  });

  // POST /api/auth/tenant-api-key-token — exchange a tenant API key (bfk_*) for a
  // tenant-scoped JWT so editor clients (VS Code) can call /api/projects, /api/tasks,
  // etc. The token is minted as the key's creator (human-in-the-loop identity).
  router.post('/tenant-api-key-token', async (c) => {
    const body = await c.req.json<{ apiKey: string }>();
    if (!body.apiKey) return c.json({ error: 'apiKey is required' }, 400);

    const keyHash = await hashSecret(body.apiKey);
    const [row] = await db
      .select({
        id: tenantApiKeys.id,
        tenantId: tenantApiKeys.tenantId,
        revokedAt: tenantApiKeys.revokedAt,
        createdByUserId: tenantApiKeys.createdByUserId,
      })
      .from(tenantApiKeys)
      .where(eq(tenantApiKeys.keyHash, keyHash))
      .limit(1);

    if (!row || row.revokedAt) return c.json({ error: 'Invalid or revoked API key' }, 401);
    // The token is minted AS the key's creator (human-in-the-loop) and MUST be a real
    // user: signJwt always stamps a `jti`, and authMiddleware rejects any jti without a
    // matching persisted authTokens row — so we persist it below (FK → users.id).
    if (!row.createdByUserId) {
      return c.json(
        { error: 'This API key has no associated user. Re-create it from Settings → API Keys or use device sign-in.' },
        400,
      );
    }

    // Mint + persist via the shared editor-token minter (also used by the VS Code
    // workspace switch). Persisting is required so authMiddleware's jti-revocation
    // check finds an active token — otherwise every /api call 401s.
    const { token, expiresIn } = await mintTenantSessionToken(db, c.env.JWT_SECRET, {
      userId: row.createdByUserId,
      tenantId: row.tenantId,
      userAgent: getUserAgent(c),
      ipAddress: getClientIp(c),
    });
    return c.json({ token, expiresIn, tenantId: row.tenantId, userId: row.createdByUserId });
  });

  // -------------------------------------------------------------------------
  // Web / marketplace auth
  // -------------------------------------------------------------------------

  // POST /api/auth/web/register
  router.post('/web/register', async (c) => {
    const body = await c.req.json<{
      email: string;
      username?: string;
      password: string;
      agreeToTerms?: boolean;
      accountType?: string;
      anonId?: string;
    }>();
    if (!body.email || !body.password) {
      return c.json({ error: 'email and password are required' }, 400);
    }
    // Optional landing anon-id — threaded through so the verification path can carry it.
    const anonId = typeof body.anonId === 'string' && body.anonId.trim() ? body.anonId.trim() : undefined;
    // 'freelancer' = restricted gig account for hire; anything else = standard.
    const accountType = body.accountType === 'freelancer' ? 'freelancer' : 'standard';
    if (body.agreeToTerms !== true) {
      return c.json({ error: 'You must accept the Terms of Use and Privacy Policy' }, 400);
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

    const [termsDoc, privacyDoc] = await Promise.all([
      getActiveLegalDoc(db, 'terms'),
      getActiveLegalDoc(db, 'privacy'),
    ]);

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
        accountType,
        // A freelancer account is inherently for-hire.
        availableForHire: accountType === 'freelancer',
        // The register form is an explicit role choice, so mark it selected now —
        // the onboarding gate must never re-prompt a password signup.
        accountTypeSelectedAt: sql`now()`,
        // Capture the language THIS signup is happening in (NEXT_LOCALE cookie, then
        // Accept-Language) so the very first email — the verification code, sent a
        // few lines below — is already in it. Null when the request gives no usable
        // hint; the resolver then falls back per its documented chain.
        locale: localeFromHeaders(headerHints(c.req)),
      })
      .returning();

    if (!created) return c.json({ error: 'Failed to create user' }, 500);

    await db.insert(userLegalAcceptances).values([
      { userId: created.id, documentType: 'terms', version: termsDoc.version },
      { userId: created.id, documentType: 'privacy', version: privacyDoc.version },
    ]);

    // A freelancer gets a for-hire profile stub immediately (private + unpublished
    // until they fill it in) and is auto-provisioned a hired.video job-seeker
    // account when the partner SDK is configured — otherwise the native resume
    // path is used and hired.video linkage is filled in later on resume upload.
    if (accountType === 'freelancer') {
      await provisionFreelancer(c, created);
    }

    // Email-ownership gate: the account exists but is UNVERIFIED — no session is
    // issued until the user enters the 6-digit code we email now. This is what
    // stops fake / unowned-email signups. The client flips to the code-entry step
    // on `verificationRequired` and calls /web/register/verify to obtain a session.
    await issueVerificationCode(db, c.env, created, { force: true, anonId, headers: headerHints(c.req) });

    return c.json({
      verificationRequired: true,
      email: created.email,
    }, 201);
  });

  // POST /api/auth/web/register/verify — exchange the emailed OTP for a session.
  // `trustDevice` extends the session to 30 days (vs 24h) so a verified user isn't
  // asked to sign in again on this device for a month.
  router.post('/web/register/verify', async (c) => {
    const body = await c.req.json<{
      email?: string;
      code?: string;
      trustDevice?: boolean;
      sessionName?: string;
    }>();
    const email = normalizeEmail(body.email ?? '');
    const code = (body.code ?? '').trim();
    if (!email || !code) return c.json({ error: 'email and code are required' }, 400);

    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    // Don't reveal whether the address exists — same generic failure either way.
    if (!user) return c.json({ error: 'Invalid or expired code', reason: 'invalid' }, 401);
    if (user.isSuspended) return c.json({ error: 'Account suspended. Contact support.' }, 403);

    // Only require a code when still unverified. A double-submit / returning tab on an
    // already-verified account just mints a session (idempotent).
    if (!user.emailVerifiedAt) {
      const result = await verifyVerificationCode(db, user.id, code);
      if (result !== 'ok') {
        const messages: Record<Exclude<VerifyResult, 'ok'>, string> = {
          invalid: 'Invalid or expired code',
          expired: 'This code has expired. Request a new one.',
          too_many: 'Too many attempts. Request a new code.',
          none: 'No active code. Request a new one.',
        };
        return c.json(
          { error: messages[result], reason: result },
          result === 'invalid' ? 401 : 400,
        );
      }
      await db
        .update(users)
        .set({ emailVerifiedAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(users.id, user.id));

      // First successful verification is when a password signup becomes a real
      // account — the welcome goes here, not at the (still-unverified) insert.
      // Guarded by the `!user.emailVerifiedAt` branch, so a re-submit can't
      // send it twice. Fire-and-forget: mail failure must not fail the session.
      // The role was chosen on the register form, so the welcome carries the
      // role-specific next steps directly — no follow-up account-type email.
      // `stored: user.locale` skips the resolver's lookup: the row is already in
      // hand, and it was captured at register time from this same browser.
      void sendTransactionalEmail(
        c.env,
        db,
        user.email,
        ({ locale }) => sendWelcomeEmail(
          c.env,
          user.email,
          user.displayName ?? user.username ?? '',
          resolveAppBaseUrl(c.env),
          user.accountType === 'freelancer' ? 'freelancer' : 'standard',
          locale,
        ),
        { storedLocale: user.locale, headers: headerHints(c.req) },
      );
    }

    const expiresIn = body.trustDevice === true ? 30 * 86_400 : 86_400;
    const token = await signWebJwt(
      {
        sub: user.id,
        email: user.email,
        username: user.username ?? '',
        act: user.accountType === 'freelancer' ? 'freelancer' : undefined,
        mfa: false,
        amr: ['pwd', 'email'],
      },
      c.env.JWT_SECRET,
      expiresIn,
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
      expiresIn,
      user: toUserResponse({ ...user, emailVerifiedAt: user.emailVerifiedAt ?? new Date() }),
      mfaRequired: false,
    });
  });

  // POST /api/auth/web/register/resend — re-send a verification code (cooldown-guarded).
  // Always 200 with no detail so it can't be used to probe which emails exist / are
  // unverified.
  router.post('/web/register/resend', async (c) => {
    const body = await c.req.json<{ email?: string }>().catch(() => ({} as { email?: string }));
    const email = normalizeEmail(body.email ?? '');
    if (email) {
      const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
      if (user && !user.emailVerifiedAt && !user.isSuspended) {
        const res = await issueVerificationCode(db, c.env, user, { headers: headerHints(c.req) });
        if (!res.sent && res.cooldownSeconds) {
          return c.json({ ok: true, cooldownSeconds: res.cooldownSeconds });
        }
      }
    }
    return c.json({ ok: true });
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

    if (user.isSuspended) {
      return c.json({ error: 'Account suspended. Contact support.' }, 403);
    }

    const ok = await verifyPassword(body.password, user.passwordHash);
    if (!ok) {
      return c.json({ error: 'Invalid email or password' }, 401);
    }

    // Unverified email — the account was created but never activated. Re-send a code
    // (cooldown-guarded) and route the client into the same code-entry step instead
    // of issuing a session. Keeps a half-finished fake signup from ever logging in.
    if (!user.emailVerifiedAt) {
      await issueVerificationCode(db, c.env, user, { headers: headerHints(c.req) });
      return c.json({ verificationRequired: true, email: user.email }, 403);
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
        act: user.accountType === 'freelancer' ? 'freelancer' : undefined,
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

    const valid = await assertMfa(db, c.env, user, body.code, body.recoveryCode);
    if (!valid) return c.json({ error: 'Invalid MFA code' }, 401);

    const superadmin = canUseSuperAdmin(user);
    const token = await signWebJwt(
      {
        sub: user.id,
        email: user.email,
        username: user.username ?? '',
        sa: superadmin ? true : undefined,
        act: user.accountType === 'freelancer' ? 'freelancer' : undefined,
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
      .select({ mfaEnabled: users.mfaEnabled, onboardingCompletedAt: users.onboardingCompletedAt, onboardingProgress: users.onboardingProgress, psychometric: users.psychometric, accountType: users.accountType, accountTypeSelectedAt: users.accountTypeSelectedAt, availableForHire: users.availableForHire })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return c.json({
      user: {
        ...user,
        mfaEnabled: full?.mfaEnabled ?? false,
        onboardingCompletedAt: full?.onboardingCompletedAt ?? null,
        // Which setup steps are already done — lets the wizard resume instead of
        // restarting at step 1 (0343).
        onboardingProgress: parseOnboardingProgress(full?.onboardingProgress),
        psychometric: parsePsychometric(full?.psychometric),
        // Account type + whether the user has explicitly chosen it (Build vs
        // Hired). The onboarding gate forces the choice when not yet selected.
        accountType: full?.accountType ?? 'standard',
        accountTypeSelected: !!full?.accountTypeSelectedAt,
        // Opt-in to being hired talent (independent of accountType).
        availableForHire: full?.availableForHire ?? false,
      },
    });
  });

  // POST /api/auth/me/account-type — the ONE-TIME role choice (Build vs Hired) for
  // an account that was provisioned via OAuth / magic-link and never picked on a
  // /register form. Idempotent: once chosen it can't be flipped here (prevents
  // shell churn); returns the current account unchanged in that case.
  router.post('/me/account-type', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as UserId;
    const body = await c.req.json<{ accountType?: string }>().catch(() => ({} as { accountType?: string }));
    const accountType = body.accountType === 'freelancer' ? 'freelancer' : 'standard';

    const [existing] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!existing) return c.json({ error: 'User not found' }, 404);

    // The locale-capture point for OAuth / magic-link accounts. Their signup was a
    // cross-site redirect where the app's locale header and NEXT_LOCALE cookie are
    // unavailable, so `users.locale` is usually still NULL here. This is the first
    // request that comes from the APP itself (and therefore carries
    // X-Builderforce-Locale), and it happens before the account-type email is sent
    // a few lines below — so that mail is already in the right language.
    // Non-destructive: it only fills an empty locale, never overwrites a choice.
    await rememberUserLocale(c.env, db, userId, headerHints(c.req)).catch(() => null);

    // Already chosen — return as-is so the client can just advance.
    if (existing.accountTypeSelectedAt) {
      return c.json({ user: toUserResponse(existing), alreadySelected: true });
    }

    const [row] = await db
      .update(users)
      .set({
        accountType,
        // A freelancer account is inherently for-hire.
        availableForHire: accountType === 'freelancer',
        accountTypeSelectedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(users.id, userId))
      .returning();
    if (!row) return c.json({ error: 'Failed to update account type' }, 500);

    // Picking Hired provisions the same for-hire profile stub the register path creates.
    if (accountType === 'freelancer') {
      await provisionFreelancer(c, row);
    }

    // The role-specific next steps. Only reachable past the idempotency guard
    // above, so the choice — and this email — happen exactly once per account.
    // Fire-and-forget: mail must not fail the role selection.
    void sendTransactionalEmail(
      c.env,
      db,
      row.email,
      ({ locale }) => sendAccountTypeSelectedEmail(
        c.env,
        row.email,
        row.displayName ?? row.username ?? '',
        resolveAppBaseUrl(c.env),
        accountType,
        locale,
      ),
      { storedLocale: row.locale, headers: headerHints(c.req) },
    );

    return c.json({ user: toUserResponse(row) });
  });

  // PATCH /api/auth/me — the signed-in user edits their OWN profile. Currently the
  // personality (psychometric) only — personality is intrinsic to a person and
  // applies to any and all users, so it is NOT Pro-gated here (unlike the agent /
  // persona editor). Send `psychometric: null` to clear it. Sanitized to the same
  // trait-vector shape agents/personas store, so a person and an agent are described
  // identically.
  router.patch('/me', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as UserId;
    const body = await c.req.json<{ psychometric?: unknown }>().catch(() => ({} as { psychometric?: unknown }));

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.psychometric !== undefined) {
      updates.psychometric = body.psychometric === null ? null : sanitizePsychometricProfile(body.psychometric);
    }

    const [row] = await db.update(users).set(updates).where(eq(users.id, userId)).returning();
    if (!row) return c.json({ error: 'User not found' }, 404);
    // A personality change alters this person's assignee hovercard on every board.
    // Invalidate the cached assignee-profile map for each tenant they belong to.
    if (body.psychometric !== undefined) {
      const memberships = await db.select({ tenantId: tenantMembers.tenantId }).from(tenantMembers).where(eq(tenantMembers.userId, userId));
      await Promise.all(memberships.map((m) => invalidateCached(c.env, assigneeProfilesCacheKey(m.tenantId))));
    }
    return c.json({ user: toUserResponse(row) });
  });

  // PUT /api/auth/me/onboarding/progress — records which setup steps are done, so
  // a user who closes the wizard mid-way resumes where they left off (0343).
  // Idempotent full-state write; validated so a malformed body can't poison the row.
  router.put('/me/onboarding/progress', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as UserId;
    const body = await c.req.json<Partial<OnboardingProgress>>().catch(() => ({} as Partial<OnboardingProgress>));
    const progress = parseOnboardingProgress(JSON.stringify(body));
    if (!progress) return c.json({ error: 'Invalid onboarding progress' }, 400);
    await db
      .update(users)
      .set({ onboardingProgress: JSON.stringify(progress), updatedAt: sql`now()` })
      .where(eq(users.id, userId));
    return c.json({ progress });
  });

  // POST /api/auth/me/onboarding/complete — marks onboarding as done, stores intent
  router.post('/me/onboarding/complete', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as UserId;
    const body = await c.req.json<{ intent?: string[] }>().catch(() => ({} as { intent?: string[] }));
    const intentJson = Array.isArray(body.intent) ? JSON.stringify(body.intent) : null;
    await db
      .update(users)
      .set({
        onboardingCompletedAt: sql`now()`,
        ...(intentJson !== null && { userIntent: intentJson }),
        updatedAt: sql`now()`,
      })
      .where(eq(users.id, userId));
    return c.json({ ok: true });
  });

  // GET /api/auth/me/admin-access — impersonation sessions targeting the current user (transparency endpoint)
  router.get('/me/admin-access', webAuthMiddleware, async (c) => {
    const userId = c.get('userId') as UserId;
    const rows = await db
      .select({
        id: adminImpersonationSessions.id,
        adminUserId: adminImpersonationSessions.adminUserId,
        tenantId: adminImpersonationSessions.tenantId,
        tenantName: tenants.name,
        roleOverride: adminImpersonationSessions.roleOverride,
        reason: adminImpersonationSessions.reason,
        startedAt: adminImpersonationSessions.startedAt,
        endedAt: adminImpersonationSessions.endedAt,
        endReason: adminImpersonationSessions.endReason,
        pagesVisited: adminImpersonationSessions.pagesVisited,
        writeBlockCount: adminImpersonationSessions.writeBlockCount,
      })
      .from(adminImpersonationSessions)
      .innerJoin(tenants, eq(tenants.id, adminImpersonationSessions.tenantId))
      .where(eq(adminImpersonationSessions.targetUserId, userId))
      .orderBy(desc(adminImpersonationSessions.startedAt))
      .limit(20);
    return c.json({
      sessions: rows.map((r) => ({
        ...r,
        pagesVisited: (() => { try { return JSON.parse(r.pagesVisited as string); } catch { return []; } })(),
        startedAt: r.startedAt?.toISOString(),
        endedAt: r.endedAt?.toISOString() ?? null,
      })),
    });
  });

  // POST /api/auth/agentHost-token – a BuilderForce Agents instance authenticates with its API key
  // Returns a tenant-scoped JWT so the agentHost can call all tenant APIs.
  router.post('/agentHost-token', async (c) => {
    const body = await c.req.json<{ apiKey: string }>();
    if (!body.apiKey) return c.json({ error: 'apiKey is required' }, 400);

    const keyHash = await hashSecret(body.apiKey);
    const [agentHost] = await db
      .select()
      .from(agentHosts)
      .where(eq(agentHosts.apiKeyHash, keyHash))
      .limit(1);

    if (!agentHost || agentHost.status !== 'active') {
      return c.json({ error: 'Invalid or inactive API key' }, 401);
    }

    const expiresIn = 3600;
    const token = await signJwt(
      { sub: `agentHost:${agentHost.id}`, tid: agentHost.tenantId, role: TenantRole.DEVELOPER },
      c.env.JWT_SECRET,
      expiresIn,
    );
    return c.json({ token, expiresIn, agentHostId: agentHost.id, tenantId: agentHost.tenantId });
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
    const encrypted = await encryptSecretForStorage(secret, credentialSecret(c.env), { upgrade: true });
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
      issuer: 'BuilderForce Link',
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

    const secret = await decryptSecretFromStorage(user.mfaTempSecretEnc, credentialSecret(c.env), { legacySecret: c.env.JWT_SECRET });
    const valid = await verifyTotpCode(secret, body.code);
    if (!valid) return c.json({ error: 'Invalid MFA code' }, 401);

    const encryptedSecret = await encryptSecretForStorage(secret, credentialSecret(c.env), { upgrade: true });
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

    const valid = await assertMfa(db, c.env, user, body.code, body.recoveryCode);
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

    const valid = await assertMfa(db, c.env, user, body.code, body.recoveryCode);
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
