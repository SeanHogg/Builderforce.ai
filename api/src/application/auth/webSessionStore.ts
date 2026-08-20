/**
 * ONE place a freshly-minted web session is written down.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * Recording a session is the same act however the person proved who they are —
 * password, MFA, email verification, OAuth, magic link, SSO, and now a passkey.
 * It had two implementations that had already drifted:
 *
 *   · `presentation/routes/authRoutes.ts` — `persistToken` + `ensureSession`.
 *     Decodes with the shared `decodeJwtPayload`, UPSERTS the session row
 *     (re-activating a revoked one and touching `lastSeenAt`).
 *   · `presentation/routes/oauthRoutes.ts` — `persistWebToken`, whose own comment
 *     said it "mirrors the pattern in authRoutes.ts". It hand-rolled the base64url
 *     decode, INSERTED the session only when absent — so an OAuth sign-in on a
 *     previously revoked session id left `is_active = false` and never refreshed
 *     the user agent — and computed the expiry with its own fallback instead of
 *     reading `exp`.
 *
 * Two copies of "what a session is" is two answers to "am I signed in", and the
 * drift above was already the second answer being wrong. Adding a third caller
 * (passkeys) is what forced the extraction rather than a third copy.
 *
 * Layer note: this is an application-layer use case — it coordinates the token
 * decode (infrastructure) with two tables. Routes call it; it calls nothing in
 * presentation.
 */

import { eq, sql } from 'drizzle-orm';
import { authTokens, authUserSessions } from '../../infrastructure/database/schema';
import { decodeJwtPayload, signWebJwt } from '../../infrastructure/auth/JwtService';
import type { Db } from '../../infrastructure/database/connection';

/** The claims this module reads. A token missing `jti` is not recorded. */
interface SessionTokenClaims {
  sub: string;
  jti?: string;
  sid?: string;
  tid?: number;
  exp: number;
}

export interface WebSessionContext {
  userId: string;
  tenantId?: number;
  tokenType?: 'web' | 'tenant';
  sessionName?: string | null;
  userAgent?: string | null;
  ipAddress?: string | null;
  /** Used when the token itself carries no `sid`. */
  fallbackSessionId?: string;
}

/**
 * Upsert the session row. A session id that already exists is RE-ACTIVATED rather
 * than left alone: signing in again on a session that was revoked is a new sign-in,
 * and the device details are the fresh ones, not the ones from last time.
 */
export async function ensureAuthSession(
  db: Db,
  opts: {
    sessionId: string;
    userId: string;
    sessionName?: string | null;
    userAgent?: string | null;
    ipAddress?: string | null;
  },
): Promise<void> {
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

/**
 * Record an issued token and the session it belongs to. A token with no `jti`
 * cannot be revoked individually, so there is nothing useful to record and this
 * returns without writing — that is a property of the token, not a failure.
 */
export async function persistWebSessionToken(
  db: Db,
  token: string,
  opts: WebSessionContext,
): Promise<void> {
  const payload = decodeJwtPayload<SessionTokenClaims>(token);
  if (!payload.jti) return;

  const sessionId = payload.sid ?? opts.fallbackSessionId;
  if (sessionId) {
    await ensureAuthSession(db, {
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
    tokenType: opts.tokenType ?? 'web',
    issuedAt: new Date(),
    expiresAt: new Date(payload.exp * 1000),
    userAgent: opts.userAgent ?? null,
    ipAddress: opts.ipAddress ?? null,
  });
}

/** What a signed-in caller is told about themselves. */
export interface WebSessionUser {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  accountType: string;
  accountTypeSelected: boolean;
  availableForHire: boolean;
  isSuperadmin: boolean;
  mfaEnabled: boolean;
}

export interface IssuedWebSession {
  token: string;
  expiresIn: number;
  user: WebSessionUser;
}

/**
 * Mint a web session and record it — the two halves that must never happen apart.
 *
 * Sign-and-persist was written out at every place a session begins, which meant a
 * new sign-in path could mint a token and forget to record it. A token that is not
 * in `auth_tokens` cannot be revoked, so that omission produces a session nobody
 * can end. Doing both here makes the omission unrepresentable.
 *
 * `claims` carries what the specific proof establishes — `amr`, whether a second
 * factor was satisfied — because that genuinely differs per path and is the one
 * thing this function must not decide on the caller's behalf.
 */
export async function issueWebSession(
  db: Db,
  jwtSecret: string,
  user: WebSessionUser & { isSuspended?: boolean },
  claims: { amr: string[]; mfa: boolean },
  session: { expiresIn?: number; sessionName?: string | null; userAgent?: string | null; ipAddress?: string | null },
): Promise<IssuedWebSession> {
  const expiresIn = session.expiresIn ?? 86_400;
  const token = await signWebJwt(
    {
      sub: user.id,
      email: user.email,
      username: user.username,
      sa: user.isSuperadmin ? true : undefined,
      act: user.accountType === 'standard' ? undefined : user.accountType,
      mfa: claims.mfa,
      amr: claims.amr,
    },
    jwtSecret,
    expiresIn,
  );

  await persistWebSessionToken(db, token, {
    userId: user.id,
    sessionName: session.sessionName ?? 'Current device',
    userAgent: session.userAgent ?? null,
    ipAddress: session.ipAddress ?? null,
  });

  const { isSuspended: _suspended, ...safe } = user;
  return { token, expiresIn, user: safe };
}
