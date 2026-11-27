/**
 * Renew a web session token — the use case behind `POST /api/auth/web/renew`.
 *
 * Web access tokens are short-lived (`WEB_ACCESS_TOKEN_TTL_SECONDS`); the
 * browser swaps the current one for a successor before it lapses, and after a sleep
 * or a closed lid it swaps the lapsed one. Renewal is ROTATION:
 *
 *   - Any validly-signed web token may be presented, expired or not. The gates are
 *     the session, not the access token's `exp`: the session must be inside its
 *     maximum age (`sat + sma`, refused past it with `session_expired`) and still
 *     active, and the presented jti must be the CURRENT token of its session.
 *   - The successor gets a NEW jti under the SAME `sid`; `sat`/`sma` carry forward
 *     unchanged, so the session end never moves. The presented row is marked
 *     `superseded_by` the successor ({@link supersedeToken}).
 *   - Presenting a token that was already superseded:
 *       · within {@link RENEW_REPLAY_WINDOW_SECONDS} of that rotation, while the
 *         successor is still current — the same renewal arriving twice (two tabs at
 *         one instant, a response lost on the wire). The answer is the SAME successor,
 *         re-signed at its original `iat`.
 *       · otherwise — a copy of a token that has since been rotated. The whole session
 *         is ended (every token of the `sid`) and the answer is `session_revoked`.
 *   - A token revoked any other way (sign-out, admin revoke) is `token_revoked`.
 *
 * A token issued before `sat` existed reads `sat` as `iat` and `sma` as its own
 * original lifetime (`exp - iat`). Identity claims are rebuilt from the user row
 * (account type, superadmin), so a long session picks up changes.
 */

import { eq } from 'drizzle-orm';
import {
  decodeJwtPayload,
  isTokenRejection,
  signWebJwt,
  verifyWebJwt,
  type WebJwtPayload,
} from '../../infrastructure/auth/JwtService';
import { users } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { revokeSessionTokens } from './sessionRevocation';
import { findTokenForRenewal, supersedeToken, type RenewalTokenRow } from './tokenRotation';
import { recordAuthToken } from './webSessionStore';

/**
 * How long after a rotation the SAME old token still gets the same successor back.
 * Covers two tabs renewing at one instant and a renewal whose response was lost and
 * is retried (the browser times a renewal out at 10 s and retries 30 s later).
 */
export const RENEW_REPLAY_WINDOW_SECONDS = 60;

export type RenewFailureCode =
  | 'invalid_token'
  | 'token_revoked'
  | 'session_revoked'
  | 'session_expired'
  | 'account_unavailable';

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
const INVALID = refuse('invalid_token', 'Invalid token');
const REVOKED = refuse('token_revoked', 'Token has been revoked');

interface Chain {
  claims: WebJwtPayload & { jti: string };
  sat: number;
  sma: number;
  sessionEnd: number;
  now: number;
}

export async function renewWebSession(
  db: Db,
  env: Env,
  presentedToken: string,
  ctx: RenewContext,
): Promise<RenewResult> {
  const now = ctx.nowSeconds ?? Math.floor(Date.now() / 1000);

  let claims: WebJwtPayload;
  try {
    claims = await verifyWebJwt(presentedToken, env.JWT_SECRET, { ignoreExpiry: true });
  } catch (error) {
    // A refused token is an answer; anything else (no signing secret) is a server fault.
    if (isTokenRejection(error)) return INVALID;
    throw error;
  }
  if (!claims.jti || claims.mfaPending) return INVALID;

  const sat = claims.sat ?? claims.iat;
  const sma = claims.sma ?? claims.exp - claims.iat;
  const sessionEnd = sat + sma;
  if (now >= sessionEnd) return refuse('session_expired', 'Session has reached its maximum age');
  const chain: Chain = { claims: { ...claims, jti: claims.jti }, sat, sma, sessionEnd, now };

  const row = await findTokenForRenewal(db, claims.sub, claims.jti);
  if (!row || (claims.sid && row.sessionId && row.sessionId !== claims.sid)) return REVOKED;
  // Renewal continues a WEB session only; a workspace, API or host token is never exchanged here.
  if (row.tokenType !== 'web') return INVALID;
  if (row.revokedAt) return answerRotated(db, env, chain, row, ctx);
  if (!row.sessionLive) return REVOKED;

  const user = await loadUser(db, claims.sub);
  if (!user) return refuse('account_unavailable', 'Account unavailable');

  const token = await signSuccessor(env, chain, user, ctx, { nowSeconds: now });
  const successorJti = decodeJwtPayload<{ jti: string }>(token).jti;
  // Record the successor BEFORE retiring the presented token: a failure between the two
  // leaves two live tokens for a moment, never none.
  await recordAuthToken(db, token, {
    userId: user.id,
    sessionId: row.sessionId,
    tokenType: 'web',
    userAgent: ctx.userAgent ?? null,
    ipAddress: ctx.ipAddress ?? null,
  });
  if (!(await supersedeToken(db, env, { userId: user.id, jti: claims.jti, successorJti }))) {
    // A concurrent renewal of the same token won the compare-and-set. Withdraw ours and
    // answer with the winner's successor, exactly as a repeat would be answered.
    await revokeSessionTokens(db, env, { userId: user.id, jti: successorJti });
    const settled = await findTokenForRenewal(db, claims.sub, claims.jti);
    return settled?.revokedAt ? answerRotated(db, env, chain, settled, ctx) : REVOKED;
  }

  return issued(token, chain);
}

/** The presented token is no longer current: a repeat of its renewal, a copy, or plainly revoked. */
async function answerRotated(
  db: Db,
  env: Env,
  chain: Chain,
  row: RenewalTokenRow,
  ctx: RenewContext,
): Promise<RenewResult> {
  const { claims, now } = chain;
  if (!row.supersededBy) return REVOKED;

  const rotatedAt = Math.floor((row.revokedAt as Date).getTime() / 1000);
  if (now - rotatedAt <= RENEW_REPLAY_WINDOW_SECONDS) {
    const successor = await findTokenForRenewal(db, claims.sub, row.supersededBy);
    if (successor && !successor.revokedAt && successor.sessionLive) {
      const user = await loadUser(db, claims.sub);
      if (!user) return refuse('account_unavailable', 'Account unavailable');
      const iat = Math.floor(successor.issuedAt.getTime() / 1000);
      const token = await signSuccessor(env, chain, user, ctx, { nowSeconds: iat, jti: successor.jti });
      return issued(token, chain);
    }
  }

  // A superseded token presented outside the replay window, or whose successor has itself
  // moved on: end the whole session, every token minted under it.
  await revokeSessionTokens(db, env, row.sessionId
    ? { userId: claims.sub, sessionId: row.sessionId }
    : { userId: claims.sub, jti: row.supersededBy });
  return refuse('session_revoked', 'Session has been ended');
}

interface RenewalUser {
  id: string;
  email: string;
  username: string | null;
  accountType: string | null;
  isSuperadmin: boolean;
}

async function loadUser(db: Db, userId: string): Promise<RenewalUser | null> {
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
    .where(eq(users.id, userId))
    .limit(1);
  return user && !user.isSuspended ? user : null;
}

function signSuccessor(
  env: Env,
  chain: Chain,
  user: RenewalUser,
  ctx: RenewContext,
  at: { nowSeconds: number; jti?: string },
): Promise<string> {
  return signWebJwt(
    {
      sub: user.id,
      email: user.email,
      username: user.username ?? '',
      sa: ctx.isSuperadmin(user) ? true : undefined,
      act: !user.accountType || user.accountType === 'standard' ? undefined : user.accountType,
      mfa: chain.claims.mfa,
      amr: chain.claims.amr,
      jti: at.jti,
      sid: chain.claims.sid,
      sat: chain.sat,
      sma: chain.sma,
    },
    env.JWT_SECRET,
    chain.sma,
    { nowSeconds: at.nowSeconds },
  );
}

function issued(token: string, chain: Chain): RenewResult {
  const { exp } = decodeJwtPayload<{ exp: number }>(token);
  return { ok: true, token, expiresIn: Math.max(0, exp - chain.now), sessionExpiresAt: chain.sessionEnd };
}
