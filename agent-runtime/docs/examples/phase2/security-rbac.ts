/**
 * Example: Security and RBAC
 */

import {
  BasicSecurityService,
  type SecurityContext,
  type RepoPolicy,
} from "../../src/security/index.js";

async function main() {
  console.log("=== builderForceAgents Phase 2 Security Example ===\n");

  const securityService = new BasicSecurityService();

  // 1. Authenticate a user
  console.log("1. Authenticating user...");
  const developer = await securityService.authenticateUser("local", {
    email: "dev@example.com",
    name: "Developer",
  });
  console.log(`   User authenticated: ${developer.name} (${developer.id})\n`);

  // 2. Verify device
  console.log("2. Verifying device...");
  const device = await securityService.verifyDevice("laptop-001");
  console.log(`   Device: ${device.id}`);
  console.log(`   Trust Level: ${device.trustLevel}\n`);

  // 3. Create session with developer role
  console.log("3. Creating session...");
  const session = await securityService.createSession(developer.id, device.id, ["developer"]);
  console.log(`   Session: ${session.sessionId}`);
  console.log(`   Roles: ${session.roles.join(", ")}\n`);

  // 4. Get effective permissions
  console.log("4. Getting effective permissions...");
  const permissions = await securityService.getEffectivePermissions(session);
  console.log("   Permissions:");
  permissions.forEach((perm) => console.log(`     - ${perm}`));
  console.log();

  // 5. Create security context
  const context: SecurityContext = {
    user: developer,
    device,
    session,
    effectivePermissions: permissions,
  };

  // 6. Check permissions
  console.log("5. Checking permissions...");

  const taskSubmitCheck = await securityService.checkPermission(context, "task:submit");
  console.log(`   task:submit: ${taskSubmitCheck.allowed ? "✓ Allowed" : "✗ Denied"}`);

  const configWriteCheck = await securityService.checkPermission(context, "config:write");
  console.log(`   config:write: ${configWriteCheck.allowed ? "✓ Allowed" : "✗ Denied"}`);
  if (!configWriteCheck.allowed) {
    console.log(`   Reason: ${configWriteCheck.reason}`);
  }
  console.log();

  // 7. Set up repo policy
  console.log("6. Setting up repo policy...");
  const repoPolicy: RepoPolicy = {
    repoPath: "/projects/example",
    enforceTrust: true,
    minimumTrustLevel: "verified",
    allowedRoles: ["developer", "admin"],
    agentPolicies: [
      {
        agentId: "code-modifier",
        allowedRoles: ["developer", "admin"],
        deniedRoles: [],
        requireDeviceTrust: "verified",
      },
    ],
    skillPolicies: [
      {
        skillId: "shell-exec",
        requiredPermissions: ["skill:execute"],
        allowedRoles: ["developer"],
        dangerous: true,
        description: "Execute shell commands",
      },
    ],
  };

  await securityService.setRepoPolicy(repoPolicy);
  console.log(`   Repo policy set for: ${repoPolicy.repoPath}\n`);

  // 8. Check agent access
  console.log("7. Checking agent access...");
  session.scope = ["/projects/example"];

  const agentCheck = await securityService.checkAgentAccess(context, "code-modifier");
  console.log(`   code-modifier agent: ${agentCheck.allowed ? "✓ Allowed" : "✗ Denied"}`);
  if (!agentCheck.allowed) {
    console.log(`   Reason: ${agentCheck.reason}`);
  }
  console.log();

  // 9. Check skill access
  console.log("8. Checking skill access...");
  const skillCheck = await securityService.checkSkillAccess(context, "shell-exec");
  console.log(`   shell-exec skill: ${skillCheck.allowed ? "✓ Allowed" : "✗ Denied"}`);
  if (!skillCheck.allowed) {
    console.log(`   Reason: ${skillCheck.reason}`);
  }
  console.log();

  // 10. Record audit log
  console.log("9. Recording audit log...");
  await securityService.audit({
    action: "task.submit",
    userId: developer.id,
    deviceId: device.id,
    sessionId: session.sessionId,
    resourceType: "task",
    resourceId: "task-001",
    result: "allowed",
    metadata: {
      taskDescription: "Example task",
    },
  });
  console.log("   Audit entry recorded\n");

  // 11. Query audit log
  console.log("10. Querying audit log...");
  const logs = await securityService.getAuditLog({
    userId: developer.id,
  });
  console.log(`   Found ${logs.length} audit entries`);
  logs.forEach((log) => {
    console.log(`   - ${log.timestamp.toISOString()}: ${log.action} (${log.result})`);
  });

  console.log("\nExample complete!");
}

main().catch(console.error);
