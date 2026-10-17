/**
 * THE cached tenant-membership read — "is this user an ACTIVE member of this tenant,
 * what is their CURRENT role, and are they a platform superadmin?"
 *
 * One read, two consumers, so they can never disagree about who a member is:
 *   - the LLM gateway (`application/llm/gatewayAccess`) — JWT callers, and the
 *     creator of a `bfk_*` key;
 *   - `authMiddleware` — every `/api/*` request bearing a workspace JWT, which until
 *     this existed trusted the token's `tid`/`role` for its whole lifetime.
 *
 * Served through `keyResolutionCache`'s `jwt` regime: keyed on tenant+user (every
 * token the user holds for that tenant shares one entry), 60 s KV / 15 s L1. A
 * removed or demoted member therefore loses access within that window at worst, and
 * immediately where the write path announces it through THE membership mutation
 * hook, `application/tenant/membershipChanged` — which every member remove / role
 * change (`TenantService`, the admin role route, the demo seeder) and tenant delete
 * already call, and which drops exactly this entry. Warm path: zero Neon round trips.
 */

import { and, eq } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { tenantMembers, users } from '../../infrastructure/database/schema';
import { TenantRole, ROLE_ORDER } from '../../domain/shared/types';
import { jwtMembershipHash, resolveKeyCached } from '../../infrastructure/auth/keyResolutionCache';

/** A member's standing in a tenant, as the membership resolver answers it. */
export interface ResolvedMembership {
  isSuperadmin: boolean;
  /** The member's CURRENT role in this tenant — a value the vocabulary knows, or null. */
  role: TenantRole | null;
}

const knownRole = (value: unknown): TenantRole | null =>
  ROLE_ORDER.includes(value as TenantRole) ? (value as TenantRole) : null;

/**
 * Resolve (tenant, user) membership, cache first. Returns null when the user is not an
 * ACTIVE member. `loadDb` is called only on a miss, so a warm hit opens no client.
 */
export async function resolveTenantMembership(
  env: Env,
  loadDb: () => Db,
  tenantId: number,
  userId: string,
): Promise<ResolvedMembership | null> {
  const resolved = await resolveKeyCached(env, 'jwt', jwtMembershipHash(tenantId, userId), async () => {
    const [membership] = await loadDb()
      .select({
        userId: tenantMembers.userId,
        role: tenantMembers.role,
        isSuperadmin: users.isSuperadmin,
      })
      .from(tenantMembers)
      .innerJoin(users, eq(users.id, tenantMembers.userId))
      .where(and(
        eq(tenantMembers.tenantId, tenantId),
        eq(tenantMembers.userId, userId),
        eq(tenantMembers.isActive, true),
      ))
      .limit(1);
    if (!membership) return { ok: false, reason: 'User is not an active member of this tenant' };
    return {
      ok: true,
      payload: { isSuperadmin: membership.isSuperadmin === true, role: knownRole(membership.role) },
    };
  });
  if (!resolved.ok) return null;
  const payload = resolved.payload as { isSuperadmin?: unknown; role?: unknown };
  return { isSuperadmin: payload.isSuperadmin === true, role: knownRole(payload.role) };
}

/**
 * The role a request runs with: the LOWER of what the token claims and what the
 * membership says NOW. A demotion bites on the next request; a promotion never
 * silently elevates an already-issued token (the member re-selects the workspace to
 * pick it up). An unknown token role or an unknown membership role changes nothing —
 * the token's claim stands, exactly as before this check existed.
 */
export function effectiveTenantRole(tokenRole: TenantRole, memberRole: TenantRole | null): TenantRole {
  if (memberRole === null) return tokenRole;
  const claimed = ROLE_ORDER.indexOf(tokenRole);
  if (claimed < 0) return tokenRole;
  return ROLE_ORDER.indexOf(memberRole) < claimed ? memberRole : tokenRole;
}
