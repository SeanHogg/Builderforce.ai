/**
 * The effective role × permission matrix — THE computation, for the superadmin
 * matrix screen (`GET /api/admin/permissions/matrix`) and its download
 * (`admin.permission-matrix` export source).
 *
 * Both used to read the overrides and fold them per role themselves; the
 * download's copy re-filtered the override list and re-resolved the role for
 * every (permission × role) cell.
 */
import type { Db } from '../../infrastructure/database/connection';
import { rolePermissionOverrides } from '../../infrastructure/database/schema';
import { ROLE_ORDER, type TenantRole } from '../../domain/shared/types';
import { ALL_PERMISSIONS, resolveRolePermissions, type Permission } from '../../domain/permissions/permissionRegistry';

export interface PermissionMatrix {
  roles: readonly TenantRole[];
  permissions: readonly Permission[];
  /** role → its effective permissions (defaults with overrides applied). */
  matrix: Record<string, Permission[]>;
  overrides: Array<{ role: string; permission: string; granted: boolean }>;
}

export async function loadPermissionMatrix(db: Db): Promise<PermissionMatrix> {
  const overrides = await db.select().from(rolePermissionOverrides);
  const matrix: Record<string, Permission[]> = {};
  for (const role of ROLE_ORDER) {
    matrix[role] = resolveRolePermissions(role, overrides.filter((o) => o.role === role));
  }
  return {
    roles: ROLE_ORDER,
    permissions: ALL_PERMISSIONS,
    matrix,
    overrides: overrides.map((o) => ({ role: o.role, permission: o.permission, granted: o.granted })),
  };
}
