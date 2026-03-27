/**
 * Client-side permission registry mirror.
 * This is the default role → permission matrix used for client-side gating
 * (PermissionGate, Permission Debugger, Role Preview).
 *
 * Server-side overrides from role_permission_overrides are not applied here;
 * the Permission Debugger fetches the resolved matrix from /api/admin/permissions/matrix
 * for an accurate view.
 */

export const PERMISSIONS = {
  PROJECT_READ:       'project:read',
  PROJECT_WRITE:      'project:write',
  PROJECT_DELETE:     'project:delete',
  PROJECT_ARCHIVE:    'project:archive',
  TASK_READ:          'task:read',
  TASK_WRITE:         'task:write',
  TASK_DELETE:        'task:delete',
  TASK_ASSIGN:        'task:assign',
  WORKFLOW_READ:      'workflow:read',
  WORKFLOW_WRITE:     'workflow:write',
  WORKFLOW_EXECUTE:   'workflow:execute',
  WORKFLOW_DELETE:    'workflow:delete',
  CLAW_READ:          'claw:read',
  CLAW_REGISTER:      'claw:register',
  CLAW_CONFIGURE:     'claw:configure',
  CLAW_DELETE:        'claw:delete',
  MEMBER_READ:        'member:read',
  MEMBER_INVITE:      'member:invite',
  MEMBER_REMOVE:      'member:remove',
  MEMBER_PROMOTE:     'member:promote',
  BILLING_READ:       'billing:read',
  BILLING_MANAGE:     'billing:manage',
  REPORT_READ:        'report:read',
  REPORT_EXPORT:      'report:export',
  APPROVAL_READ:      'approval:read',
  APPROVAL_APPROVE:   'approval:approve',
  APPROVAL_CONFIGURE: 'approval:configure',
  MARKETPLACE_READ:       'marketplace:read',
  MARKETPLACE_PURCHASE:   'marketplace:purchase',
  MARKETPLACE_PUBLISH:    'marketplace:publish',
  APIKEY_READ:    'apikey:read',
  APIKEY_ROTATE:  'apikey:rotate',
  APIKEY_DELETE:  'apikey:delete',
  AUDIT_READ:     'audit:read',
} as const;

export type Permission = typeof PERMISSIONS[keyof typeof PERMISSIONS];

const VIEWER: Permission[] = [
  'project:read', 'task:read', 'workflow:read', 'claw:read',
  'member:read', 'approval:read', 'marketplace:read',
];

const DEVELOPER: Permission[] = [
  ...VIEWER,
  'project:write', 'task:write', 'task:assign', 'workflow:write', 'workflow:execute',
  'claw:register', 'report:read', 'apikey:read', 'apikey:rotate',
];

const MANAGER: Permission[] = [
  ...DEVELOPER,
  'project:delete', 'project:archive', 'task:delete', 'workflow:delete',
  'claw:configure', 'claw:delete', 'member:invite', 'member:remove',
  'billing:read', 'report:export', 'approval:approve', 'marketplace:purchase', 'audit:read',
];

const OWNER: Permission[] = [
  ...MANAGER,
  'member:promote', 'billing:manage', 'approval:configure',
  'marketplace:publish', 'apikey:delete',
];

export const DEFAULT_ROLE_PERMISSIONS: Record<string, Permission[]> = {
  viewer:    VIEWER,
  developer: DEVELOPER,
  manager:   MANAGER,
  owner:     OWNER,
};

/** All known permission keys. */
export const ALL_PERMISSIONS: Permission[] = [...new Set(OWNER)];

/**
 * Check if a role has a specific permission (client-side, defaults only).
 */
export function hasPermission(role: string, permission: string): boolean {
  return (DEFAULT_ROLE_PERMISSIONS[role] ?? []).includes(permission as Permission);
}
