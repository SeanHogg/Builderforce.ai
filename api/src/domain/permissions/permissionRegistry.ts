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
  // 2026-08-19: the work/delivery surfaces operators most want overrides on.
  // ── Migrated 2026-08-19 ────────────────────────────────────────────────────
  // Gated on the SESSION-authenticated handlers of each route group. Machine
  // callers were deliberately left alone: `requirePermission` reads tenantId +
  // userId + role off the context, and an agent-host key sets none of them, so
  // gating those handlers would 403 the entire fleet rather than authorise it.
  'project:read',
  'project:write',
  'project:delete',
  'task:read',
  'task:write',
  'task:delete',
  'task:assign',
  'workflow:read',
  'workflow:write',
  'member:read',
  'report:read',
  'report:export',
  'workflow:execute',
  'agentHost:read',
  'agentHost:register',
  'agentHost:configure',
  'agentHost:delete',
  'marketplace:read',
  'marketplace:purchase',
  'marketplace:publish',
]);

/**
 * Permissions that CANNOT be enforced by `requirePermission` as the platform is built,
 * and why — so the gap is a stated design fact rather than a silent omission.
 *
 * The `system:*` four are Super Admin actions, and Super Admin routes authenticate with
 * `superAdminMiddleware`, which establishes a `userId` and nothing else: no tenantId, no
 * member role. `requirePermission` resolves a permission for a MEMBER OF A TENANT, so on
 * those routes it would reject every caller, superadmin included. They are already gated
 * by something strictly stronger than a permission — being a superadmin at all — and the
 * admin matrix marks them advisory.
 *
 * `project:archive` and `workflow:delete` have no route that performs the action yet;
 * `member:read` and `approval:read` are covered by their route groups' role gate and have
 * no separate read endpoint to attach to.
 */
export const UNENFORCEABLE_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>([
  'system:impersonate',
  'system:debug_permissions',
  'system:manage_roles',
  'system:manage_modules',
]);

/**
 * The permissions that remain ADVISORY, and why — so the next person does not
 * re-derive the analysis or, worse, add a gate that breaks a live surface.
 *
 * Three distinct reasons, none of them "nobody got round to it":
 *
 *   - **No surface exists.** `project:archive` has no archive route, and there is
 *     no ad-hoc report export endpoint beyond the scheduled deliveries already
 *     gated by `report:export`. A gate cannot be added to a route that is not there.
 *
 *   - **The caller is not a tenant member.** `marketplace:read` / `:purchase` /
 *     `:publish` live behind `requireMarketplaceAuth`, a SEPARATE identity system
 *     (marketplace accounts) with no `tenantId`/`role` on the request.
 *     `requirePermission` reads exactly those, so gating the marketplace router
 *     would 403 every marketplace user. Making these real means unifying the two
 *     identities first, which is a design change, not a middleware line.
 *
 *   - **The caller is a machine.** `agentHost:*` is spread across a router where
 *     roughly half the endpoints authenticate with a host API key and never
 *     establish a member session, and `workflow:execute` is the claim/host-result
 *     pair on that same seam. `approval:read` sits on a router with the same mix.
 *     A blanket gate there takes the agent fleet offline. The tenant-JWT half of
 *     `workflowRoutes` IS gated — the split is the point.
 *
 * `permissionEnforcement.test.ts` keeps this honest in both directions.
 */

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
