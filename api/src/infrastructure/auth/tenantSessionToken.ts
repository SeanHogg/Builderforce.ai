import { decodeJwtPayload, signJwt } from './JwtService';
import { parseTokenTimeToDate } from './MfaService';
import { authTokens } from '../database/schema';
import { TenantRole } from '../../domain/shared/types';
import type { Db } from '../database/connection';

/**
 * Mint a tenant-scoped session JWT for an editor/API client (VS Code) and persist it
 * so `authMiddleware`'s jti-revocation check accepts it (an unpersisted jti is treated
 * as revoked). This is the SINGLE place that issues editor tenant tokens — used by both
 * the `bfk_*` key exchange and the VS Code workspace switch — so they can never drift.
 *
 * Tenant session tokens carry no `sid` (no prior login session), so there is no session
 * row to ensure — just the auth-token record keyed by the JWT's jti.
 */
export async function mintTenantSessionToken(
  db: Db,
  jwtSecret: string,
  opts: {
    userId: string;
    tenantId: number;
    role?: TenantRole;
    userAgent?: string | null;
    ipAddress?: string | null;
    expiresIn?: number;
  },
): Promise<{ token: string; expiresIn: number }> {
  const expiresIn = opts.expiresIn ?? 3600;
  const token = await signJwt(
    { sub: opts.userId, tid: opts.tenantId, role: opts.role ?? TenantRole.DEVELOPER },
    jwtSecret,
    expiresIn,
  );
  const payload = decodeJwtPayload<{ jti?: string; exp: number }>(token);
  if (payload.jti) {
    await db.insert(authTokens).values({
      jti: payload.jti,
      userId: opts.userId,
      sessionId: null,
      tenantId: opts.tenantId,
      tokenType: 'tenant',
      issuedAt: new Date(),
      expiresAt: parseTokenTimeToDate(payload.exp),
      userAgent: opts.userAgent ?? null,
      ipAddress: opts.ipAddress ?? null,
    });
  }
  return { token, expiresIn };
}
