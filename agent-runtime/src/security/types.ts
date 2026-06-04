/**
 * Identity & Security Model — RBAC, device trust, granular policy enforcement
 * Supports OIDC, GitHub SSO, device trust, and RBAC
 */

/**
 * Identity provider types
 */
export type IdentityProvider = "oidc" | "github" | "google" | "local";

/**
 * User identity information
 */
export type UserIdentity = {
  id: string;
  provider: IdentityProvider;
  email?: string;
  name?: string;
  avatar?: string;
  verified: boolean;
  metadata?: Record<string, unknown>;
};

/**
 * Device trust level
 */
export type DeviceTrustLevel = "trusted" | "verified" | "untrusted";

/**
 * Device information
 */
export type DeviceInfo = {
  id: string;
  name: string;
  type: "desktop" | "mobile" | "server" | "ci";
  trustLevel: DeviceTrustLevel;
  lastSeen: Date;
  publicKey?: string;
  metadata?: Record<string, unknown>;
};

/**
 * Permission types
 */
export type Permission =
  | "task:submit"
  | "task:read"
  | "task:cancel"
  | "agent:invoke"
  | "skill:execute"
  | "config:read"
  | "config:write"
  | "admin:all";

/**
 * Role definition
 */
export type Role = {
  id: string;
  name: string;
  description: string;
  permissions: Permission[];
  constraints?: Record<string, unknown>;
};

/**
 * Built-in roles
 */
export const BUILTIN_ROLES: Record<string, Role> = {
  admin: {
    id: "admin",
    name: "Administrator",
    description: "Full system access",
    permissions: ["admin:all"],
  },
  developer: {
    id: "developer",
    name: "Developer",
    description: "Can submit tasks and invoke agents",
    permissions: ["task:submit", "task:read", "task:cancel", "agent:invoke", "skill:execute"],
  },
  readonly: {
    id: "readonly",
    name: "Read Only",
    description: "Can only view task status",
    permissions: ["task:read", "config:read"],
  },
  ci: {
    id: "ci",
    name: "CI/CD",
    description: "Automated system access",
    permissions: ["task:submit", "task:read", "agent:invoke"],
  },
};

/**
 * Session-level permissions
 */
export type SessionPermissions = {
  sessionId: string;
  userId: string;
  deviceId: string;
  roles: string[];
  grantedAt: Date;
  expiresAt?: Date;
  scope?: string[];
};

/**
 * Agent-level authorization
 */
export type AgentAuthorization = {
  agentId: string;
  allowedRoles: string[];
  deniedRoles: string[];
  requireDeviceTrust?: DeviceTrustLevel;
  constraints?: Record<string, unknown>;
};

/**
 * Skill execution privileges
 */
export type SkillPrivileges = {
  skillId: string;
  requiredPermissions: Permission[];
  allowedRoles: string[];
  trustLevel?: DeviceTrustLevel;
  dangerous: boolean;
  description: string;
};

/**
 * Security context for request
 */
export type SecurityContext = {
  user?: UserIdentity;
  device?: DeviceInfo;
  session: SessionPermissions;
  effectivePermissions: Permission[];
};

/**
 * Policy enforcement result
 */
export type PolicyCheckResult = {
  allowed: boolean;
  reason?: string;
  requiredPermissions?: Permission[];
  missingPermissions?: Permission[];
};

/**
 * Repo-level policy
 */
export type RepoPolicy = {
  repoPath: string;
  enforceTrust: boolean;
  minimumTrustLevel: DeviceTrustLevel;
  allowedRoles: string[];
  deniedUsers?: string[];
  allowedUsers?: string[];
  agentPolicies: AgentAuthorization[];
  skillPolicies: SkillPrivileges[];
  customRules?: string[];
};

/**
 * Audit log entry
 */
export type AuditLogEntry = {
  id: string;
  timestamp: Date;
  action: string;
  userId?: string;
  deviceId?: string;
  sessionId?: string;
  resourceType: "task" | "agent" | "skill" | "config";
  resourceId: string;
  result: "allowed" | "denied" | "error";
  reason?: string;
  metadata?: Record<string, unknown>;
};

/**
 * Security service interface
 */
export interface SecurityService {
  /**
   * Authenticate a user
   */
  authenticateUser(provider: IdentityProvider, credentials: unknown): Promise<UserIdentity>;

  /**
   * Verify device trust
   */
  verifyDevice(deviceId: string): Promise<DeviceInfo>;

  /**
   * Create session with permissions
   */
  createSession(userId: string, deviceId: string, roles: string[]): Promise<SessionPermissions>;

  /**
   * Check if action is allowed
   */
  checkPermission(
    context: SecurityContext,
    permission: Permission,
    resource?: string,
  ): Promise<PolicyCheckResult>;

  /**
   * Get effective permissions for session
   */
  getEffectivePermissions(session: SessionPermissions): Promise<Permission[]>;

  /**
   * Record audit log entry
   */
  audit(entry: Omit<AuditLogEntry, "id" | "timestamp">): Promise<void>;

  /**
   * Get repo policy
   */
  getRepoPolicy(repoPath: string): Promise<RepoPolicy | null>;

  /**
   * Check if agent invocation is allowed
   */
  checkAgentAccess(context: SecurityContext, agentId: string): Promise<PolicyCheckResult>;

  /**
   * Check if skill execution is allowed
   */
  checkSkillAccess(context: SecurityContext, skillId: string): Promise<PolicyCheckResult>;
}
