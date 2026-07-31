import { and, eq } from 'drizzle-orm';
import { decodeJwtPayload, signJwt } from './JwtService';
import { parseTokenTimeToDate } from './MfaService';
import { authTokens, tenantMembers } from '../database/schema';
import { TenantRole } from '../../domain/shared/types';
import type { Db } from '../database/connection';

/** Map a persisted tenant_members.role string to a TenantRole; unknown → DEVELOPER. */
function toTenantRole(role: string | null | undefined): TenantRole {
  return (Object.values(TenantRole) as string[]).includes(role ?? '')
    ? (role as TenantRole)
    : TenantRole.DEVELOPER;
}

/**
 * Resolve a user's EFFECTIVE role in a tenant from their active membership row.
 * This is the single source the editor-token minter uses so an owner/manager who
 * signs in via the editor (bfk_* key exchange or workspace switch) is granted the
 * same authority they hold on the web — not a flat DEVELOPER token. Non-members
 * (should not reach here) fall back to DEVELOPER.
 */
async function resolveMemberRole(db: Db, userId: string, tenantId: number): Promise<TenantRole> {
  const [member] = await db
    .select({ role: tenantMembers.role })
    .from(tenantMembers)
    .where(
      and(
        eq(tenantMembers.userId, userId),
        eq(tenantMembers.tenantId, tenantId),
        eq(tenantMembers.isActive, true),
      ),
    )
    .limit(1);
  return toTenantRole(member?.role);
}

/**
 * Mint a tenant-scoped session JWT for an editor/API client (VS Code) and persist it
 * so `authMiddleware`'s jti-revocation check accepts it (an unpersisted jti is treated
 * as revoked). This is the SINGLE place that issues editor tenant tokens — used by both
 * the `bfk_*` key exchange and the VS Code workspace switch — so they can never drift.
 *
 * The token carries the user's REAL tenant role (resolved from their active membership)
 * so an owner/manager gets manager-gated features (e.g. running diagnostics) in the
 * editor exactly as on the web. Pass `opts.role` only to force a specific role.
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
  const role = opts.role ?? (await resolveMemberRole(db, opts.userId, opts.tenantId));
  const token = await signJwt(
    { sub: opts.userId, tid: opts.tenantId, role },
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
