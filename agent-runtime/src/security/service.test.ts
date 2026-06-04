/**
 * Tests for security service
 */

import { describe, it, expect, beforeEach } from "vitest";
import { BasicSecurityService } from "./service.js";
import type { SecurityContext, RepoPolicy } from "./types.js";

describe("BasicSecurityService", () => {
  let service: BasicSecurityService;

  beforeEach(() => {
    service = new BasicSecurityService();
  });

  describe("authenticateUser", () => {
    it("should authenticate a user", async () => {
      const user = await service.authenticateUser("local", {
        email: "test@example.com",
        name: "Test User",
      });

      expect(user.id).toBeDefined();
      expect(user.email).toBe("test@example.com");
      expect(user.name).toBe("Test User");
      expect(user.verified).toBe(true);
    });
  });

  describe("verifyDevice", () => {
    it("should register a new device", async () => {
      const device = await service.verifyDevice("device-1");

      expect(device.id).toBe("device-1");
      expect(device.trustLevel).toBe("untrusted");
      expect(device.lastSeen).toBeInstanceOf(Date);
    });

    it("should update lastSeen for existing device", async () => {
      const device1 = await service.verifyDevice("device-1");
      const firstSeen = device1.lastSeen;

      await new Promise((resolve) => setTimeout(resolve, 10));

      const device2 = await service.verifyDevice("device-1");
      expect(device2.lastSeen.getTime()).toBeGreaterThan(firstSeen.getTime());
    });
  });

  describe("createSession", () => {
    it("should create a session with permissions", async () => {
      const user = await service.authenticateUser("local", {
        email: "test@example.com",
      });
      const device = await service.verifyDevice("device-1");

      const session = await service.createSession(user.id, device.id, ["developer"]);

      expect(session.sessionId).toBeDefined();
      expect(session.userId).toBe(user.id);
      expect(session.deviceId).toBe(device.id);
      expect(session.roles).toContain("developer");
      expect(session.grantedAt).toBeInstanceOf(Date);
      expect(session.expiresAt).toBeInstanceOf(Date);
    });
  });

  describe("getEffectivePermissions", () => {
    it("should get permissions for admin role", async () => {
      const user = await service.authenticateUser("local", {
        email: "admin@example.com",
      });
      const device = await service.verifyDevice("device-1");
      const session = await service.createSession(user.id, device.id, ["admin"]);

      const permissions = await service.getEffectivePermissions(session);

      expect(permissions).toContain("admin:all");
    });

    it("should get permissions for developer role", async () => {
      const user = await service.authenticateUser("local", {
        email: "dev@example.com",
      });
      const device = await service.verifyDevice("device-1");
      const session = await service.createSession(user.id, device.id, ["developer"]);

      const permissions = await service.getEffectivePermissions(session);

      expect(permissions).toContain("task:submit");
      expect(permissions).toContain("agent:invoke");
      expect(permissions).toContain("skill:execute");
    });

    it("should merge permissions from multiple roles", async () => {
      const user = await service.authenticateUser("local", {
        email: "user@example.com",
      });
      const device = await service.verifyDevice("device-1");
      const session = await service.createSession(user.id, device.id, ["developer", "readonly"]);

      const permissions = await service.getEffectivePermissions(session);

      expect(permissions).toContain("task:submit");
      expect(permissions).toContain("config:read");
    });
  });

  describe("checkPermission", () => {
    it("should allow action with required permission", async () => {
      const user = await service.authenticateUser("local", {
        email: "dev@example.com",
      });
      const device = await service.verifyDevice("device-1");
      const session = await service.createSession(user.id, device.id, ["developer"]);
      const permissions = await service.getEffectivePermissions(session);

      const context: SecurityContext = {
        user,
        device,
        session,
        effectivePermissions: permissions,
      };

      const result = await service.checkPermission(context, "task:submit");

      expect(result.allowed).toBe(true);
    });

    it("should deny action without required permission", async () => {
      const user = await service.authenticateUser("local", {
        email: "user@example.com",
      });
      const device = await service.verifyDevice("device-1");
      const session = await service.createSession(user.id, device.id, ["readonly"]);
      const permissions = await service.getEffectivePermissions(session);

      const context: SecurityContext = {
        user,
        device,
        session,
        effectivePermissions: permissions,
      };

      const result = await service.checkPermission(context, "task:submit");

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("task:submit");
    });

    it("should allow all actions with admin permission", async () => {
      const user = await service.authenticateUser("local", {
        email: "admin@example.com",
      });
      const device = await service.verifyDevice("device-1");
      const session = await service.createSession(user.id, device.id, ["admin"]);
      const permissions = await service.getEffectivePermissions(session);

      const context: SecurityContext = {
        user,
        device,
        session,
        effectivePermissions: permissions,
      };

      const result = await service.checkPermission(context, "config:write");

      expect(result.allowed).toBe(true);
    });
  });

  describe("checkAgentAccess", () => {
    it("should allow agent invocation with permission", async () => {
      const user = await service.authenticateUser("local", {
        email: "dev@example.com",
      });
      const device = await service.verifyDevice("device-1");
      const session = await service.createSession(user.id, device.id, ["developer"]);
      const permissions = await service.getEffectivePermissions(session);

      const context: SecurityContext = {
        user,
        device,
        session,
        effectivePermissions: permissions,
      };

      const result = await service.checkAgentAccess(context, "test-agent");

      expect(result.allowed).toBe(true);
    });

    it("should enforce repo policy for agent access", async () => {
      const user = await service.authenticateUser("local", {
        email: "dev@example.com",
      });
      const device = await service.verifyDevice("device-1");
      const session = await service.createSession(user.id, device.id, ["developer"]);
      session.scope = ["/test/repo"];
      const permissions = await service.getEffectivePermissions(session);

      const repoPolicy: RepoPolicy = {
        repoPath: "/test/repo",
        enforceTrust: true,
        minimumTrustLevel: "verified",
        allowedRoles: ["admin"],
        agentPolicies: [
          {
            agentId: "restricted-agent",
            allowedRoles: ["admin"],
            deniedRoles: [],
          },
        ],
        skillPolicies: [],
      };

      await service.setRepoPolicy(repoPolicy);

      const context: SecurityContext = {
        user,
        device,
        session,
        effectivePermissions: permissions,
      };

      const result = await service.checkAgentAccess(context, "restricted-agent");

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("admin");
    });
  });

  describe("checkSkillAccess", () => {
    it("should allow skill execution with permission", async () => {
      const user = await service.authenticateUser("local", {
        email: "dev@example.com",
      });
      const device = await service.verifyDevice("device-1");
      const session = await service.createSession(user.id, device.id, ["developer"]);
      const permissions = await service.getEffectivePermissions(session);

      const context: SecurityContext = {
        user,
        device,
        session,
        effectivePermissions: permissions,
      };

      const result = await service.checkSkillAccess(context, "test-skill");

      expect(result.allowed).toBe(true);
    });

    it("should deny dangerous skills on untrusted devices", async () => {
      const user = await service.authenticateUser("local", {
        email: "dev@example.com",
      });
      const device = await service.verifyDevice("device-1");
      device.trustLevel = "untrusted";
      const session = await service.createSession(user.id, device.id, ["developer"]);
      session.scope = ["/test/repo"];
      const permissions = await service.getEffectivePermissions(session);

      const repoPolicy: RepoPolicy = {
        repoPath: "/test/repo",
        enforceTrust: true,
        minimumTrustLevel: "verified",
        allowedRoles: ["developer"],
        agentPolicies: [],
        skillPolicies: [
          {
            skillId: "dangerous-skill",
            requiredPermissions: ["skill:execute"],
            allowedRoles: ["developer"],
            dangerous: true,
            description: "Dangerous skill",
          },
        ],
      };

      await service.setRepoPolicy(repoPolicy);

      const context: SecurityContext = {
        user,
        device,
        session,
        effectivePermissions: permissions,
      };

      const result = await service.checkSkillAccess(context, "dangerous-skill");

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("dangerous");
    });
  });

  describe("audit", () => {
    it("should record audit log entry", async () => {
      await service.audit({
        action: "task.submit",
        userId: "user-1",
        sessionId: "session-1",
        resourceType: "task",
        resourceId: "task-1",
        result: "allowed",
      });

      const logs = await service.getAuditLog();
      expect(logs).toHaveLength(1);
      expect(logs[0].action).toBe("task.submit");
      expect(logs[0].result).toBe("allowed");
    });

    it("should filter audit logs", async () => {
      await service.audit({
        action: "task.submit",
        userId: "user-1",
        sessionId: "session-1",
        resourceType: "task",
        resourceId: "task-1",
        result: "allowed",
      });

      await service.audit({
        action: "agent.invoke",
        userId: "user-2",
        sessionId: "session-2",
        resourceType: "agent",
        resourceId: "agent-1",
        result: "denied",
      });

      const user1Logs = await service.getAuditLog({ userId: "user-1" });
      expect(user1Logs).toHaveLength(1);
      expect(user1Logs[0].userId).toBe("user-1");

      const taskLogs = await service.getAuditLog({ action: "task.submit" });
      expect(taskLogs).toHaveLength(1);
      expect(taskLogs[0].action).toBe("task.submit");
    });
  });
});
