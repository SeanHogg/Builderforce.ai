/**
 * Permission Registry
 *
 * Canonical resource:action definitions and the default role permission matrix.
 * This is the authoritative source of truth for what permissions exist.
 *
 * The matrix can be overridden per-role via `role_permission_overrides` in the DB.
 * Per-user grants/revocations are stored in `user_permission_overrides`.
 *
 * ENFORCEMENT — read this before adding a permission.
 *
 * The platform gates requests two ways: the 4-tier role ladder (`requireRole`,
 * ~411 sites) and this registry (`requirePermission`). For a long time only the
 * first one ran: the registry existed, the admin Permission Debugger rendered it,
 * operators set overrides — and nothing consulted them. A revoked permission was
 * cosmetic.
 *
 * {@link ENFORCED_PERMISSIONS} closes that honesty gap. A permission in that set
 * is backed by a real `requirePermission` gate on every route it names; anything
 * else is still advisory, and the admin matrix labels it as such rather than
 * implying control it does not have. Migrating a route group means adding the
 * gate AND adding the permission to the set — `permissionEnforcement.test.ts`
 * fails the build if the two disagree in either direction.
 *
 * There is no frontend mirror of this file. The UI gates on capabilities
 * (`frontend/src/lib/rbac.ts` → `<RoleGate>`), which is a different, deliberately
 * coarser model, and the admin debugger reads the resolved matrix from
 * `/api/admin/permissions/matrix` — so the server stays the single source and
 * there is nothing to drift.
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

  // AgentHosts
  AGENT_HOST_READ:         'agentHost:read',
  AGENT_HOST_REGISTER:     'agentHost:register',
  AGENT_HOST_CONFIGURE:    'agentHost:configure',
  AGENT_HOST_DELETE:       'agentHost:delete',

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

/**
 * Permissions that a `requirePermission` gate actually enforces today.
 *
 * Everything else in {@link ALL_PERMISSIONS} is still gated only by the role
 * ladder, so an override on it changes what the admin screen displays but not
 * what a request may do. The matrix endpoint returns this set so the UI can say
 * which is which instead of implying uniform control.
 *
 * To move a permission from advisory to enforced: add `requirePermission(...)`
 * to every route that performs the action, then add the permission here.
 * `permissionEnforcement.test.ts` asserts the two stay in step — it fails both
 * when a gate exists without an entry and when an entry exists without a gate.
 */
export const ENFORCED_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>([
  'apikey:read',
  'apikey:rotate',
  'apikey:delete',
  'audit:read',
  'billing:read',
  'billing:manage',
  'approval:approve',
  'approval:configure',
  'member:invite',
  'member:remove',
  'member:promote',
]);

/** Is this permission backed by a real request-time gate? */
export function isPermissionEnforced(permission: string): boolean {
  return ENFORCED_PERMISSIONS.has(permission as Permission);
}

// ---------------------------------------------------------------------------
// Default role → permission matrix
// viewer < developer < manager < owner
// ---------------------------------------------------------------------------

const VIEWER_PERMS: Permission[] = [
  'project:read',
  'task:read',
  'workflow:read',
  'agentHost:read',
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
  'agentHost:register',
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
  'agentHost:configure',
  'agentHost:delete',
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
