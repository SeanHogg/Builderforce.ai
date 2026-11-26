/**
 * Renew a web session token — the use case behind `POST /api/auth/web/renew`.
 *
 * Web access tokens are short-lived ({@link WEB_ACCESS_TOKEN_TTL_SECONDS}); the
 * browser calls this in the background before one lapses. A renewal:
 *
 *   - accepts the current token, or one that lapsed up to
 *     {@link WEB_RENEW_GRACE_SECONDS} ago, as long as its `jti` is still live
 *     (not revoked, session still active);
 *   - never moves the session end: `sat` (session start) and `sma` (max age) are
 *     carried forward unchanged, and a session past `sat + sma` is refused with
 *     `session_expired`. A token issued before `sat` existed reads `sat` as `iat`
 *     and `sma` as its own original lifetime (`exp - iat`);
 *   - issues a token with a NEW `jti` under the SAME `sid`, records it, and
 *     revokes the presented `jti` — so the token being replaced stops working
 *     as soon as the renewal lands rather than at its own `exp`.
 *
 * Identity claims are rebuilt from the user row (account type, superadmin), so a
 * long-lived session picks up changes instead of freezing the claims of its login.
 */

import { eq } from 'drizzle-orm';
import {
  WEB_ACCESS_TOKEN_TTL_SECONDS,
  WEB_RENEW_GRACE_SECONDS,
  signWebJwt,
  verifyWebJwt,
} from '../../infrastructure/auth/JwtService';
import { UnauthorizedError } from '../../domain/shared/errors';
import { users } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { assertActiveToken, findActiveToken, revokeSessionTokens } from './sessionRevocation';
import { persistWebSessionToken } from './webSessionStore';

export type RenewFailureCode = 'invalid_token' | 'token_revoked' | 'session_expired' | 'account_unavailable';

export type RenewResult =
  | { ok: true; token: string; expiresIn: number; sessionExpiresAt: number }
  | { ok: false; code: RenewFailureCode; error: string };

export interface RenewContext {
  userAgent?: string | null;
  ipAddress?: string | null;
  /** The platform's superadmin rule (one definition, owned by the auth routes). */
  isSuperadmin: (user: { email: string; isSuperadmin: boolean }) => boolean;
  /** Unix seconds; injected for tests. */
  nowSeconds?: number;
}

const refuse = (code: RenewFailureCode, error: string): RenewResult => ({ ok: false, code, error });

export async function renewWebSession(
  db: Db,
  env: Env,
  presentedToken: string,
  ctx: RenewContext,
): Promise<RenewResult> {
  const now = ctx.nowSeconds ?? Math.floor(Date.now() / 1000);

  let claims;
  try {
    claims = await verifyWebJwt(presentedToken, env.JWT_SECRET, { nowSeconds: now - WEB_RENEW_GRACE_SECONDS });
  } catch {
    return refuse('invalid_token', 'Invalid or expired token');
  }
  if (!claims.jti || claims.mfaPending) return refuse('invalid_token', 'Invalid or expired token');

  const sat = claims.sat ?? claims.iat;
  const sma = claims.sma ?? claims.exp - claims.iat;
  const sessionEnd = sat + sma;
  if (now >= sessionEnd) return refuse('session_expired', 'Session has reached its maximum age');

  try {
    assertActiveToken(await findActiveToken(db, claims.sub, claims.jti, WEB_RENEW_GRACE_SECONDS));
  } catch (error) {
    if (error instanceof UnauthorizedError) return refuse('token_revoked', 'Token has been revoked');
    throw error;
  }

  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      username: users.username,
      accountType: users.accountType,
      isSuperadmin: users.isSuperadmin,
      isSuspended: users.isSuspended,
    })
    .from(users)
    .where(eq(users.id, claims.sub))
    .limit(1);
  if (!user || user.isSuspended) return refuse('account_unavailable', 'Account unavailable');

  const token = await signWebJwt(
    {
      sub: user.id,
      email: user.email,
      username: user.username ?? '',
      sa: ctx.isSuperadmin(user) ? true : undefined,
      act: user.accountType === 'standard' ? undefined : user.accountType,
      mfa: claims.mfa,
      amr: claims.amr,
      sid: claims.sid,
      sat,
      sma,
    },
    env.JWT_SECRET,
    sma,
  );

  // Record the new token BEFORE revoking the old one: a failure between the two
  // leaves two live tokens for a moment, never none.
  await persistWebSessionToken(db, token, {
    userId: user.id,
    tokenType: 'web',
    userAgent: ctx.userAgent ?? null,
    ipAddress: ctx.ipAddress ?? null,
  });
  await revokeSessionTokens(db, env, { userId: user.id, jti: claims.jti });

  return {
    ok: true,
    token,
    expiresIn: Math.min(WEB_ACCESS_TOKEN_TTL_SECONDS, sessionEnd - now),
    sessionExpiresAt: sessionEnd,
  };
}
