/**
 * Basic security service implementation
 * Provides RBAC, device trust, and policy enforcement
 */

import crypto from "node:crypto";
import type {
  AuditLogEntry,
  DeviceInfo,
  IdentityProvider,
  Permission,
  PolicyCheckResult,
  RepoPolicy,
  SecurityContext,
  SecurityService,
  SessionPermissions,
  UserIdentity,
} from "./types.js";
import { BUILTIN_ROLES } from "./types.js";

/**
 * In-memory security service implementation
 */
export class BasicSecurityService implements SecurityService {
  private users = new Map<string, UserIdentity>();
  private devices = new Map<string, DeviceInfo>();
  private sessions = new Map<string, SessionPermissions>();
  private repoPolicies = new Map<string, RepoPolicy>();
  private auditLog: AuditLogEntry[] = [];

  /**
   * Authenticate a user (simplified - real impl would validate credentials)
   */
  async authenticateUser(provider: IdentityProvider, credentials: unknown): Promise<UserIdentity> {
    // This is a simplified implementation
    // Real implementation would validate credentials with OAuth/OIDC providers
    const creds = credentials as { email: string; name?: string };

    const userId = crypto.randomUUID();
    const user: UserIdentity = {
      id: userId,
      provider,
      email: creds.email,
      name: creds.name,
      verified: true,
    };

    this.users.set(userId, user);
    return user;
  }

  /**
   * Verify device trust
   */
  async verifyDevice(deviceId: string): Promise<DeviceInfo> {
    let device = this.devices.get(deviceId);

    if (!device) {
      // Register new device with default untrusted level
      device = {
        id: deviceId,
        name: "Unknown Device",
        type: "desktop",
        trustLevel: "untrusted",
        lastSeen: new Date(),
      };
      this.devices.set(deviceId, device);
    } else {
      device.lastSeen = new Date();
      this.devices.set(deviceId, device);
    }

    return device;
  }

  /**
   * Create session with permissions
   */
  async createSession(
    userId: string,
    deviceId: string,
    roles: string[],
  ): Promise<SessionPermissions> {
    const sessionId = crypto.randomUUID();
    const session: SessionPermissions = {
      sessionId,
      userId,
      deviceId,
      roles,
      grantedAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  /**
   * Check if action is allowed
   */
  async checkPermission(
    context: SecurityContext,
    permission: Permission,
    _resource?: string,
  ): Promise<PolicyCheckResult> {
    // Check if user has admin permission (allows everything)
    if (context.effectivePermissions.includes("admin:all")) {
      return { allowed: true };
    }

    // Check if user has the specific permission
    if (context.effectivePermissions.includes(permission)) {
      return { allowed: true };
    }

    return {
      allowed: false,
      reason: `Missing required permission: ${permission}`,
      requiredPermissions: [permission],
      missingPermissions: [permission],
    };
  }

  /**
   * Get effective permissions for session
   */
  async getEffectivePermissions(session: SessionPermissions): Promise<Permission[]> {
    const permissions = new Set<Permission>();

    for (const roleId of session.roles) {
      const role = BUILTIN_ROLES[roleId];
      if (role) {
        for (const permission of role.permissions) {
          permissions.add(permission);
        }
      }
    }

    return Array.from(permissions);
  }

  /**
   * Record audit log entry
   */
  async audit(entry: Omit<AuditLogEntry, "id" | "timestamp">): Promise<void> {
    const logEntry: AuditLogEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      ...entry,
    };

    this.auditLog.push(logEntry);

    // In production, this would write to persistent storage
    // and possibly send to monitoring/alerting systems
  }

  /**
   * Get repo policy
   */
  async getRepoPolicy(repoPath: string): Promise<RepoPolicy | null> {
    return this.repoPolicies.get(repoPath) || null;
  }

  /**
   * Set repo policy
   */
  async setRepoPolicy(policy: RepoPolicy): Promise<void> {
    this.repoPolicies.set(policy.repoPath, policy);
  }

  /**
   * Check if agent invocation is allowed
   */
  async checkAgentAccess(context: SecurityContext, agentId: string): Promise<PolicyCheckResult> {
    // Check basic permission
    const permissionCheck = await this.checkPermission(context, "agent:invoke");
    if (!permissionCheck.allowed) {
      return permissionCheck;
    }

    // Check repo policy if available
    if (context.session.scope && context.session.scope.length > 0) {
      const repoPath = context.session.scope[0];
      const repoPolicy = await this.getRepoPolicy(repoPath);

      if (repoPolicy) {
        const agentPolicy = repoPolicy.agentPolicies.find((p) => p.agentId === agentId);

        if (agentPolicy) {
          // Check if any of user's roles are allowed
          const hasAllowedRole = context.session.roles.some((role) =>
            agentPolicy.allowedRoles.includes(role),
          );

          if (!hasAllowedRole) {
            return {
              allowed: false,
              reason: `Agent ${agentId} requires one of roles: ${agentPolicy.allowedRoles.join(", ")}`,
            };
          }

          // Check device trust if required
          if (agentPolicy.requireDeviceTrust && context.device) {
            if (
              agentPolicy.requireDeviceTrust === "trusted" &&
              context.device.trustLevel !== "trusted"
            ) {
              return {
                allowed: false,
                reason: `Agent ${agentId} requires trusted device`,
              };
            }
          }
        }
      }
    }

    return { allowed: true };
  }

  /**
   * Check if skill execution is allowed
   */
  async checkSkillAccess(context: SecurityContext, skillId: string): Promise<PolicyCheckResult> {
    // Check basic permission
    const permissionCheck = await this.checkPermission(context, "skill:execute");
    if (!permissionCheck.allowed) {
      return permissionCheck;
    }

    // Check repo policy if available
    if (context.session.scope && context.session.scope.length > 0) {
      const repoPath = context.session.scope[0];
      const repoPolicy = await this.getRepoPolicy(repoPath);

      if (repoPolicy) {
        const skillPolicy = repoPolicy.skillPolicies.find((p) => p.skillId === skillId);

        if (skillPolicy) {
          // Check if user has all required permissions
          for (const permission of skillPolicy.requiredPermissions) {
            const check = await this.checkPermission(context, permission);
            if (!check.allowed) {
              return check;
            }
          }

          // Check if any of user's roles are allowed
          const hasAllowedRole = context.session.roles.some((role) =>
            skillPolicy.allowedRoles.includes(role),
          );

          if (!hasAllowedRole) {
            return {
              allowed: false,
              reason: `Skill ${skillId} requires one of roles: ${skillPolicy.allowedRoles.join(", ")}`,
            };
          }

          // Check device trust if required for dangerous skills
          if (skillPolicy.dangerous && context.device) {
            if (context.device.trustLevel === "untrusted") {
              return {
                allowed: false,
                reason: `Skill ${skillId} is dangerous and requires trusted device`,
              };
            }
          }
        }
      }
    }

    return { allowed: true };
  }

  /**
   * Get audit log
   */
  async getAuditLog(filter?: {
    userId?: string;
    action?: string;
    startDate?: Date;
  }): Promise<AuditLogEntry[]> {
    let logs = [...this.auditLog];

    if (filter?.userId) {
      logs = logs.filter((log) => log.userId === filter.userId);
    }

    if (filter?.action) {
      logs = logs.filter((log) => log.action === filter.action);
    }

    if (filter?.startDate) {
      logs = logs.filter((log) => log.timestamp >= filter.startDate!);
    }

    return logs;
  }
}

/**
 * Global security service instance
 */
export const globalSecurityService = new BasicSecurityService();
