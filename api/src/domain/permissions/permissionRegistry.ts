/**
 * Permission Registry
 *
 * Canonical resource:action definitions and the default role permission matrix.
 * This is the authoritative source of truth for what permissions exist.
 *
 * The matrix can be overridden per-role via `role_permission_overrides` in the DB.
 * Per-user grants/revocations are stored in `user_permission_overrides`.
 */

export const PERMISSIONS = {
  // Projects
  PROJECT_READ:      'project:read',
  PROJECT_WRITE:     'project:write',
  PROJECT_DELETE:    'project:delete',
  PROJECT_ARCHIVE:   'project:archive',

  // Tasks
  TASK_READ:         'task:read',
  TASK_WRITE:        'task:write',
  TASK_DELETE:       'task:delete',
  TASK_ASSIGN:       'task:assign',

  // Workflows
  WORKFLOW_READ:     'workflow:read',
  WORKFLOW_WRITE:    'workflow:write',
  WORKFLOW_EXECUTE:  'workflow:execute',
  WORKFLOW_DELETE:   'workflow:delete',

  // Claws
  CLAW_READ:         'claw:read',
  CLAW_REGISTER:     'claw:register',
  CLAW_CONFIGURE:    'claw:configure',
  CLAW_DELETE:       'claw:delete',

  // Members
  MEMBER_READ:       'member:read',
  MEMBER_INVITE:     'member:invite',
  MEMBER_REMOVE:     'member:remove',
  MEMBER_PROMOTE:    'member:promote',

  // Billing
  BILLING_READ:      'billing:read',
  BILLING_MANAGE:    'billing:manage',

  // Reports
  REPORT_READ:       'report:read',
  REPORT_EXPORT:     'report:export',

  // Approvals
  APPROVAL_READ:     'approval:read',
  APPROVAL_APPROVE:  'approval:approve',
  APPROVAL_CONFIGURE:'approval:configure',

  // Marketplace
  MARKETPLACE_READ:       'marketplace:read',
  MARKETPLACE_PURCHASE:   'marketplace:purchase',
  MARKETPLACE_PUBLISH:    'marketplace:publish',

  // API Keys
  APIKEY_READ:       'apikey:read',
  APIKEY_ROTATE:     'apikey:rotate',
  APIKEY_DELETE:     'apikey:delete',

  // Audit
  AUDIT_READ:        'audit:read',

  // System (Super Admin only)
  SYSTEM_IMPERSONATE:        'system:impersonate',
  SYSTEM_DEBUG_PERMISSIONS:  'system:debug_permissions',
  SYSTEM_MANAGE_ROLES:       'system:manage_roles',
  SYSTEM_MANAGE_MODULES:     'system:manage_modules',
} as const;

export type Permission = typeof PERMISSIONS[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);

// ---------------------------------------------------------------------------
// Default role → permission matrix
// viewer < developer < manager < owner
// ---------------------------------------------------------------------------

const VIEWER_PERMS: Permission[] = [
  'project:read',
  'task:read',
  'workflow:read',
  'claw:read',
  'member:read',
  'approval:read',
  'marketplace:read',
];

const DEVELOPER_PERMS: Permission[] = [
  ...VIEWER_PERMS,
  'project:write',
  'task:write',
  'task:assign',
  'workflow:write',
  'workflow:execute',
  'claw:register',
  'report:read',
  'apikey:read',
  'apikey:rotate',
];

const MANAGER_PERMS: Permission[] = [
  ...DEVELOPER_PERMS,
  'project:delete',
  'project:archive',
  'task:delete',
  'workflow:delete',
  'claw:configure',
  'claw:delete',
  'member:invite',
  'member:remove',
  'billing:read',
  'report:export',
  'approval:approve',
  'marketplace:purchase',
  'audit:read',
];

const OWNER_PERMS: Permission[] = [
  ...MANAGER_PERMS,
  'member:promote',
  'billing:manage',
  'approval:configure',
  'marketplace:publish',
  'apikey:delete',
];

export const DEFAULT_ROLE_PERMISSIONS: Record<string, Permission[]> = {
  viewer:    VIEWER_PERMS,
  developer: DEVELOPER_PERMS,
  manager:   MANAGER_PERMS,
  owner:     OWNER_PERMS,
};

/**
 * Returns the effective permission set for a role, applying any overrides
 * from the database on top of the default matrix.
 *
 * @param role - Built-in role name
 * @param overrides - Array of {permission, granted} records from role_permission_overrides
 */
export function resolveRolePermissions(
  role: string,
  overrides: Array<{ permission: string; granted: boolean }>,
): Permission[] {
  const base = new Set<string>(DEFAULT_ROLE_PERMISSIONS[role] ?? []);
  for (const override of overrides) {
    if (override.granted) {
      base.add(override.permission);
    } else {
      base.delete(override.permission);
    }
  }
  return [...base] as Permission[];
}

/**
 * Resolves a user's effective permission set:
 * role defaults → module grants → per-user grants → per-user revocations.
 */
export function resolveEffectivePermissions(opts: {
  rolePermissions: Permission[];
  modulePermissions: string[];
  userGrants: string[];
  userRevocations: string[];
}): Permission[] {
  const set = new Set<string>([
    ...opts.rolePermissions,
    ...opts.modulePermissions,
    ...opts.userGrants,
  ]);
  for (const perm of opts.userRevocations) {
    set.delete(perm);
  }
  return [...set] as Permission[];
}
