import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * Effective permissions — the ONE resolution of "what may this member actually do?".
 *
 * The platform has carried two authorization models side by side:
 *
 *   1. The 4-tier role ladder (`requireRole`), enforced at ~411 call sites. This
 *      is what actually gates requests.
 *   2. The `resource:action` permission registry with per-role and per-user
 *      overrides, surfaced in the admin Permission Debugger — and consumed by
 *      NOTHING at request time. An operator who revoked `billing:manage` from a
 *      user saw the change persist, and the user kept full access.
 *
 * That second model was advisory-in-practice while looking authoritative. This
 * module makes it real: it resolves the same chain the admin screen displays
 * (role defaults + role overrides → module grants → per-user grants → per-user
 * revocations) and {@link requirePermission} enforces the result.
 *
 * The chain is four queries, on a request path, so it is served through the
 * canonical read-through cache and invalidated by every writer that can change
 * it ({@link invalidateMemberPermissions}, {@link invalidateRolePermissions}).
 * Overrides change a handful of times in a workspace's life; a member's
 * permission set is exactly the kind of slow-changing derived data the cache is
 * for.
 *
 * Migration is deliberately incremental — see `ENFORCED_PERMISSIONS` in the
 * registry for which permissions this gate actually backs today, and the admin
 * matrix marks the rest as advisory rather than pretending otherwise.
 */

import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  platformModules,
  rolePermissionOverrides,
  tenantMemberModules,
  userPermissionOverrides,
} from '../../infrastructure/database/schema';
import {
  resolveEffectivePermissions,
  resolveRolePermissions,
  type Permission,
} from '../../domain/permissions/permissionRegistry';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { coerceStringArray } from '../../domain/shared/jsonColumn';

/** Role-override sets are platform-global; a member's set is per (tenant, user, role). */
const roleCacheKey = (role: string) => `perms:role:${role}`;
const memberCacheKey = (tenantId: number, userId: string, role: string) =>
  `perms:member:${tenantId}:${userId}:${role}`;

const TTL_SECONDS = 900;

/** `platform_modules.permissions` is free-form JSON; keep only string entries. */

/**
 * A role's permission set after the platform-global `role_permission_overrides`
 * are applied. Shared by the gate and by the admin matrix so both show the same
 * answer.
 */
export async function permissionsForRole(db: Db, role: string, env?: Env): Promise<Permission[]> {
  const load = async () => {
    const overrides = await db
      .select({ permission: rolePermissionOverrides.permission, granted: rolePermissionOverrides.granted })
      .from(rolePermissionOverrides)
      .where(eq(rolePermissionOverrides.role, role));
    return resolveRolePermissions(role, overrides);
  };
  if (!env) return load();
  return getOrSetCached<Permission[]>(env, roleCacheKey(role), load, { kvTtlSeconds: TTL_SECONDS });
}

/**
 * The full effective permission set for one member of one workspace.
 *
 * Resolution order (last wins): role defaults → role overrides → module grants →
 * per-user grants → per-user revocations.
 */
export async function effectivePermissionsFor(
  db: Db,
  tenantId: number,
  userId: string,
  role: string,
  env?: Env,
): Promise<Permission[]> {
  const load = async (): Promise<Permission[]> => {
    // The role set may itself be cached; the two member-scoped reads are
    // independent of it and of each other, so issue all three together.
    const [rolePermissions, assignedModules, overrides] = await Promise.all([
      permissionsForRole(db, role, env),
      db
        .select({ permissions: platformModules.permissions })
        .from(tenantMemberModules)
        .innerJoin(platformModules, eq(tenantMemberModules.moduleId, platformModules.id))
        .where(and(eq(tenantMemberModules.tenantId, tenantId), eq(tenantMemberModules.userId, userId))),
      db
        .select({ permission: userPermissionOverrides.permission, granted: userPermissionOverrides.granted })
        .from(userPermissionOverrides)
        .where(and(eq(userPermissionOverrides.tenantId, tenantId), eq(userPermissionOverrides.userId, userId))),
    ]);

    return resolveEffectivePermissions({
      rolePermissions,
      modulePermissions: assignedModules.flatMap((m) => coerceStringArray(m.permissions)),
      userGrants: overrides.filter((o) => o.granted).map((o) => o.permission),
      userRevocations: overrides.filter((o) => !o.granted).map((o) => o.permission),
    });
  };

  if (!env) return load();
  return getOrSetCached<Permission[]>(env, memberCacheKey(tenantId, userId, role), load, {
    kvTtlSeconds: TTL_SECONDS,
  });
}

/** Does this member hold `permission`? */
export async function memberHasPermission(
  db: Db,
  tenantId: number,
  userId: string,
  role: string,
  permission: Permission,
  env?: Env,
): Promise<boolean> {
  const perms = await effectivePermissionsFor(db, tenantId, userId, role, env);
  return (perms as string[]).includes(permission);
}

/**
 * Drop one member's cached set. Call after changing their per-user overrides or
 * their module assignments. Roles are part of the key, so a role CHANGE needs no
 * invalidation — the new role reads a different key.
 */
export async function invalidateMemberPermissions(
  env: Env | undefined,
  tenantId: number,
  userId: string,
): Promise<void> {
  if (!env) return;
  // The role is part of the key and the caller may not know which one applies,
  // so clear every tier — four cheap deletes beat threading the role through.
  await Promise.all(
    ['viewer', 'developer', 'manager', 'owner'].map((role) =>
      invalidateCached(env, memberCacheKey(tenantId, userId, role)).catch((error) => {
        reportCaughtError(error, { source: "application/rbac/effectivePermissions.ts", operation: "invalidateMemberPermissions" });
      }),
    ),
  );
}

/**
 * Drop a role's cached override set after an operator edits the matrix.
 *
 * Member sets embed the role's permissions, so they are invalidated too — but
 * enumerating every member of every tenant is not worth it for an operation that
 * happens a handful of times ever. The member entries carry a 15-minute TTL,
 * which bounds the lag; the role entry itself is exact.
 */
export async function invalidateRolePermissions(env: Env | undefined, role: string): Promise<void> {
  if (!env) return;
  await invalidateCached(env, roleCacheKey(role)).catch((error) => {
    reportCaughtError(error, { source: "application/rbac/effectivePermissions.ts", operation: "invalidateRolePermissions" });
  });
}
