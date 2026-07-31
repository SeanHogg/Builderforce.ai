import type { MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../../env';
import { ForbiddenError } from '../../domain/shared/errors';
import { memberHasPermission } from '../../application/rbac/effectivePermissions';
import type { Permission } from '../../domain/permissions/permissionRegistry';

/**
 * Gate a route on a specific `resource:action` permission.
 *
 * This is the finer-grained counterpart to `requireRole`. Use it wherever the
 * permission registry has an exact name for what the route does — then an
 * operator's per-role or per-user override in the admin Permission Debugger
 * actually takes effect, which for a long time it did not.
 *
 * `requireRole` remains correct for the coarse tiers (and is still what most
 * routes use); the two compose. Where both are applied, the role check runs
 * first as a cheap reject and the permission check refines it.
 *
 * Must run AFTER `authMiddleware` — it reads `tenantId` / `userId` / `role` from
 * the context. Every permission gated here must be listed in
 * `ENFORCED_PERMISSIONS` so the admin matrix can tell operators which rows are
 * real and which are still advisory.
 */
export function requirePermission(permission: Permission): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    const tenantId = c.get('tenantId') as number | undefined;
    const userId = c.get('userId') as string | undefined;
    const role = c.get('role') as string | undefined;

    if (tenantId == null || !userId || !role) {
      throw new ForbiddenError('Permission check requires an authenticated workspace session');
    }

    // The auth middleware already built a Db for this request — reuse it rather
    // than opening a second connection (and reaching into infrastructure from
    // the presentation layer, which `npm run check:layering` forbids).
    const db = c.get('db');
    if (!db) {
      throw new ForbiddenError('Permission check requires an authenticated workspace session');
    }
    const allowed = await memberHasPermission(db, tenantId, userId, role, permission, c.env);
    if (!allowed) {
      throw new ForbiddenError(`Requires the '${permission}' permission`);
    }
    await next();
  };
}
