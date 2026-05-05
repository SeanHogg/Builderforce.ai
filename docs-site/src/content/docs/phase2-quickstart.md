---
summary: "Quick start guide for CoderClaw Phase 2 distributed runtime features"
read_when:
  - Getting started with Phase 2 features
  - Setting up distributed task execution
  - Configuring RBAC and security
title: "Phase 2 Quick Start"
---

# CoderClaw Phase 2 Quick Start

Get started with CoderClaw's distributed runtime, security, and team collaboration features.

> **Prerequisites**: CoderClaw installed and running. See [Getting Started](/start/getting-started) if you haven't set up the basic gateway yet.

## What is Phase 2?

CoderClaw Phase 2 extends [CoderClaw](https://github.com/SeanHogg/coderClaw)'s multi-channel gateway with:

- **🔄 Transport Abstraction**: Execute tasks locally or remotely with protocol-agnostic runtime
- **📊 Task Lifecycle Management**: Formal state machine with persistence and audit trails
- **🔐 Security Model**: RBAC, device trust levels, and comprehensive audit logging
- **🎯 Team Collaboration**: Multi-session isolation and shared agent registries

Full documentation: [Phase 2 Architecture](/phase2)

## Quick Start: Local Development

### 1. Enable Phase 2 Runtime (Optional)

Phase 2 features are **backward compatible**. Your existing setup continues to work. To opt-in to Phase 2 features:

```bash
# Create Phase 2 runtime config
mkdir -p ~/.coderclaw/.coderClaw
cat > ~/.coderclaw/.coderClaw/runtime.yaml <<EOF
mode: local-only
transport:
  type: local
  enabled: true
security:
  enforceTrust: false  # Permissive for local dev
  requireAuth: false
deployment:
  mode: local-only
  maxConcurrentTasks: 10
EOF
```

### 2. Try a Simple Task

```typescript
import { CoderClawRuntime, LocalTransportAdapter } from "coderclaw/transport";

// Create runtime with local adapter
const adapter = new LocalTransportAdapter(context);
const runtime = new CoderClawRuntime(adapter, "local-only");

// Submit a task
const task = await runtime.submitTask({
  description: "Analyze project architecture",
  input: "Review the current codebase structure",
  agentId: "architecture-advisor",
});

console.log(`Task submitted: ${task.id}`);

// Stream updates
for await (const update of runtime.streamTaskUpdates(task.id)) {
  console.log(`Status: ${update.status}, Progress: ${update.progress}%`);
}
```

### 3. Explore Task Lifecycle

```typescript
// Get task state
const taskState = await runtime.getTaskState(task.id);
console.log(`Current status: ${taskState.status}`);

// List all agents
const agents = await runtime.listAgents();
console.log(`Available agents:`, agents);

// List all skills
const skills = await runtime.listSkills();
console.log(`Available skills:`, skills);
```

## Quick Start: Team Environment

### 1. Configure Security

```bash
# Create security config
cat > ~/.coderclaw/.coderClaw/security.yaml <<EOF
identity:
  providers:
    - github
    - local

deviceTrust:
  minimumLevel: verified
  autoTrustLocal: true

roles:
  team-developer:
    inherits: developer
    additionalPermissions:
      - config:read

enforceTrust: true
minimumTrustLevel: verified
allowedRoles:
  - developer
  - team-developer
  - admin
EOF
```

### 2. Configure Runtime for Remote Access

```bash
cat > ~/.coderclaw/.coderClaw/runtime.yaml <<EOF
mode: remote-enabled
transport:
  type: local  # Use HTTP adapter for true remote (future)
  enabled: true
security:
  enforceTrust: true
  requireAuth: true
  defaultRoles: [developer]
deployment:
  mode: remote-enabled
  allowRemoteSessions: true
  maxConcurrentTasks: 50
EOF
```

### 3. Set Up Agent Policies

```bash
# Create repo-level security policy
cat > .coderClaw/security.yaml <<EOF
enforceTrust: true
minimumTrustLevel: verified
allowedRoles:
  - developer
  - admin

agentPolicies:
  - agentId: code-modifier
    allowedRoles: [developer, admin]
    requireDeviceTrust: verified

  - agentId: code-reviewer
    allowedRoles: [developer, admin, readonly]
    requireDeviceTrust: verified

skillPolicies:
  - skillId: shell-exec
    dangerous: true
    requiredPermissions: [skill:execute]
    allowedRoles: [developer, admin]

  - skillId: file-write
    requiredPermissions: [skill:execute]
    allowedRoles: [developer, admin]
EOF
```

## Examples & Tutorials

### Example 1: Task Submission with Progress Tracking

```typescript
import { DistributedTaskEngine, MemoryTaskStorage } from "coderclaw/transport";

const taskEngine = new DistributedTaskEngine(new MemoryTaskStorage());

// Create task
const task = await taskEngine.createTask({
  description: "Implement user authentication",
  input: "Add JWT-based auth to the API",
  agentId: "code-creator",
});

// Update status through state machine
await taskEngine.updateTaskStatus(task.id, "planning");
await taskEngine.updateTaskStatus(task.id, "running");

// Track progress
await taskEngine.updateTaskProgress(task.id, 25);
await taskEngine.updateTaskProgress(task.id, 50);
await taskEngine.updateTaskProgress(task.id, 75);
await taskEngine.updateTaskProgress(task.id, 100);

// Complete task
await taskEngine.setTaskOutput(task.id, "Authentication implemented successfully");
await taskEngine.updateTaskStatus(task.id, "completed");
```

### Example 2: Security Checks

```typescript
import { SecurityService, MemorySecurityStorage } from "coderclaw/security";

const securityService = new SecurityService(new MemorySecurityStorage());

// Create session with role
const session = await securityService.createSession("user-123", "device-456", ["developer"]);

// Check permissions
const canSubmit = await securityService.checkPermission(
  { sessionId: session.sessionId, userId: "user-123" },
  "task:submit",
);

if (canSubmit.allowed) {
  // Submit task
  console.log("Permission granted");
} else {
  console.log(`Permission denied: ${canSubmit.reason}`);
}

// Audit the action
await securityService.audit({
  action: "task.submit",
  userId: "user-123",
  sessionId: session.sessionId,
  resourceType: "task",
  resourceId: "task-789",
  result: "allowed",
});
```

### Example 3: Multi-Task Workflow

```typescript
// Create parent task
const parentTask = await taskEngine.createTask({
  description: "Feature development",
  input: "Build new dashboard feature",
  agentId: "architecture-advisor",
});

// Create child tasks
const designTask = await taskEngine.createTask({
  description: "Design API",
  input: "Design RESTful API for dashboard",
  agentId: "architecture-advisor",
  parentTaskId: parentTask.id,
});

const implementTask = await taskEngine.createTask({
  description: "Implement code",
  input: "Implement dashboard backend",
  agentId: "code-creator",
  parentTaskId: parentTask.id,
});

const testTask = await taskEngine.createTask({
  description: "Write tests",
  input: "Create test suite for dashboard",
  agentId: "test-generator",
  parentTaskId: parentTask.id,
});

// Execute workflow...
```

## Running the Examples

CoderClaw includes working examples in `examples/phase2/`:

```bash
# Basic task submission
npx tsx examples/phase2/basic-task-submission.ts

# Full task lifecycle demo
npx tsx examples/phase2/task-lifecycle.ts

# Security and RBAC demo
npx tsx examples/phase2/security-rbac.ts
```

## Configuration Reference

### Runtime Configuration (`~/.coderclaw/.coderClaw/runtime.yaml`)

```yaml
# Deployment mode: local-only | remote-enabled | distributed-cluster
mode: local-only

transport:
  type: local # local | http | websocket | grpc
  enabled: true

security:
  enforceTrust: false # Enable device trust enforcement
  requireAuth: false # Require authentication
  defaultRoles: [developer]

deployment:
  mode: local-only
  allowRemoteSessions: false
  maxConcurrentTasks: 10
```

### Security Configuration (`~/.coderclaw/.coderClaw/security.yaml`)

```yaml
identity:
  providers:
    - oidc
    - github
    - google
    - local

deviceTrust:
  minimumLevel: verified # trusted | verified | untrusted
  autoTrustLocal: true

roles:
  custom-role:
    inherits: developer
    additionalPermissions:
      - config:write
```

### Project Security (`.coderClaw/security.yaml`)

```yaml
enforceTrust: true
minimumTrustLevel: verified
allowedRoles:
  - developer
  - admin

agentPolicies:
  - agentId: code-creator
    allowedRoles: [developer, admin]
    requireDeviceTrust: verified

skillPolicies:
  - skillId: dangerous-skill
    dangerous: true
    requiredPermissions: [skill:execute]
    allowedRoles: [admin]
```

## Built-in Roles

CoderClaw includes these built-in roles:

| Role        | Permissions                                          | Use Case                          |
| ----------- | ---------------------------------------------------- | --------------------------------- |
| `admin`     | All permissions (`admin:all`)                        | System administrators             |
| `developer` | Task submit/read/cancel, agent invoke, skill execute | Development team                  |
| `readonly`  | Task read, config read                               | Read-only access for stakeholders |
| `ci`        | Task submit/read, agent invoke                       | CI/CD pipelines                   |

## Permissions Reference

Available permissions:

- `task:submit` - Submit new tasks
- `task:read` - View task status and details
- `task:cancel` - Cancel running tasks
- `agent:invoke` - Invoke agents directly
- `skill:execute` - Execute skills
- `config:read` - Read configuration
- `config:write` - Modify configuration
- `admin:all` - Full system access (includes all above)

## Next Steps

<Columns>
  <Card title="Full Phase 2 Documentation" href="/phase2">
    Complete architecture, API reference, and best practices
  </Card>
  <Card title="Security Guide" href="/gateway/security">
    Comprehensive security configuration and threat model
  </Card>
  <Card title="Examples Directory" href="https://github.com/SeanHogg/coderClaw/tree/main/examples/phase2">
    Working code examples for all Phase 2 features
  </Card>
  <Card title="CoderClaw Developer Guide" href="/coderclaw">
    Multi-agent workflows and project-specific configuration
  </Card>
</Columns>

## Troubleshooting

### Task submission fails with permission error

Check your security configuration:

```bash
# Verify runtime config
cat ~/.coderclaw/.coderClaw/runtime.yaml

# Check if authentication is required
# If security.requireAuth: true, you need a valid session
```

### Cannot execute task remotely

Ensure your runtime is in `remote-enabled` mode:

```yaml
# In ~/.coderclaw/.coderClaw/runtime.yaml
mode: remote-enabled
deployment:
  allowRemoteSessions: true
```

### Security policy blocks legitimate access

Review the security policy:

```bash
# Check project-level policy
cat .coderClaw/security.yaml

# Verify user roles and device trust level
```

## Getting Help

- [Full Documentation](/)
- [GitHub Issues](https://github.com/SeanHogg/coderClaw/issues)
- [Discord Community](https://discord.gg/9gUsc2sNG6)
- [Phase 2 Examples](https://github.com/SeanHogg/coderClaw/tree/main/examples/phase2)
