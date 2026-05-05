---
title: "Phase 2: Distributed AI Runtime & Secure Control Mesh"
---

# Phase 2: Distributed AI Runtime & Secure Control Mesh

CoderClaw Phase 2 introduces a networked, distributed AI node architecture with secure remote orchestration capabilities while maintaining deterministic execution and security boundaries.

> **Foundation**: CoderClaw is built on [CoderClaw](https://github.com/SeanHogg/coderClaw)'s proven multi-channel gateway architecture. Phase 2 adds enterprise-ready features for distributed execution, security, and team collaboration.

## Overview

Phase 2 transforms CoderClaw from a local-only development runtime into a distributed system that can:

- Execute tasks locally or remotely
- Manage distributed task lifecycles
- Enforce security policies across sessions
- Support team-wide collaboration
- Integrate with CI/CD systems

## Architecture

### Key Components

```
┌─────────────────────────────────────────────┐
│         Runtime Interface Contract          │
│  (Submit, Stream, Query, Cancel, List)      │
└─────────────────┬───────────────────────────┘
                  │
    ┌─────────────┴──────────────┐
    │    Transport Adapter        │
    │    (Protocol Agnostic)      │
    └─────────────┬───────────────┘
                  │
    ┌─────────────┴──────────────┐
    │  Distributed Task Engine    │
    │  (State Machine + Audit)    │
    └─────────────┬───────────────┘
                  │
    ┌─────────────┴──────────────┐
    │   Security Service (RBAC)   │
    │   (Identity + Policy)       │
    └─────────────────────────────┘
```

## 1. Transport Abstraction Layer

The transport layer provides a protocol-agnostic interface for task execution:

### Runtime Interface Contract

```typescript
interface RuntimeInterface {
  // Task management
  submitTask(request: TaskSubmitRequest): Promise<TaskState>;
  getTaskState(taskId: string): Promise<TaskState | null>;
  streamTaskUpdates(taskId: string): AsyncIterableIterator<TaskUpdateEvent>;
  cancelTask(taskId: string): Promise<boolean>;

  // Resource discovery
  listAgents(): Promise<AgentInfo[]>;
  listSkills(): Promise<SkillInfo[]>;

  // Health
  getStatus(): Promise<RuntimeStatus>;
}
```

### Transport Adapters

Transport adapters implement the communication layer without assumptions about protocol:

- **LocalTransportAdapter**: In-process execution (reference implementation)
- **HTTPTransportAdapter**: REST API-based (future)
- **WebSocketTransportAdapter**: Real-time streaming (future)
- **gRPCTransportAdapter**: High-performance RPC (future)

Example usage:

```typescript
import { CoderClawRuntime, LocalTransportAdapter } from "coderclaw/transport";

// Create runtime with local adapter
const adapter = new LocalTransportAdapter(context);
const runtime = new CoderClawRuntime(adapter, "local-only");

// Submit a task
const task = await runtime.submitTask({
  description: "Implement feature X",
  input: "Add authentication to the API",
  agentId: "code-creator",
});

// Stream updates
for await (const update of runtime.streamTaskUpdates(task.id)) {
  console.log(`Status: ${update.status}, Progress: ${update.progress}`);
}
```

## 2. Distributed Task Lifecycle

### Task State Machine

Tasks follow a well-defined state machine:

```
PENDING → PLANNING → RUNNING → COMPLETED
            ↓          ↓           ↑
            ↓       WAITING ───────┘
            ↓          ↓
            └─→ CANCELLED
            ↓
        FAILED
```

**State Transitions:**

- `PENDING → PLANNING`: Task analysis begins
- `PLANNING → RUNNING`: Execution starts
- `RUNNING → WAITING`: Waiting for external input
- `WAITING → RUNNING`: Resuming after wait
- `RUNNING → COMPLETED`: Successful completion
- `Any → FAILED`: Error occurred
- `Any (non-terminal) → CANCELLED`: User cancellation

### Task Features

**Globally Unique IDs**: Each task gets a UUID for distributed tracking

**Persistence**: Tasks are stored and can survive restarts

**Resumability**: Tasks can be paused and resumed

**Audit Trail**: Complete event history for each task

```typescript
// Get task state
const task = await taskEngine.getTask(taskId);
console.log(`Status: ${task.status}`);

// Get event history
const events = await taskEngine.getTaskEvents(taskId);
events.forEach((event) => {
  console.log(`${event.timestamp}: ${event.event} - ${event.message}`);
});
```

## 3. Identity & Security Model

### Components

**Identity Providers**:

- OIDC
- GitHub SSO
- Google OAuth
- Local authentication

**Device Trust Levels**:

- `trusted`: Fully trusted device
- `verified`: Identity verified
- `untrusted`: Unknown or untrusted

**Permissions** (RBAC):

- `task:submit` - Submit new tasks
- `task:read` - View task status
- `task:cancel` - Cancel tasks
- `agent:invoke` - Invoke agents
- `skill:execute` - Execute skills
- `config:read` - Read configuration
- `config:write` - Modify configuration
- `admin:all` - Full system access

### Built-in Roles

```typescript
const BUILTIN_ROLES = {
  admin: {
    permissions: ["admin:all"],
  },
  developer: {
    permissions: ["task:submit", "task:read", "task:cancel", "agent:invoke", "skill:execute"],
  },
  readonly: {
    permissions: ["task:read", "config:read"],
  },
  ci: {
    permissions: ["task:submit", "task:read", "agent:invoke"],
  },
};
```

### Policy Enforcement

**Session-level permissions**:

```typescript
const session = await securityService.createSession(userId, deviceId, ["developer"]);
```

**Repo-level policy** (`.coderClaw/security.yaml`):

```yaml
enforceTrust: true
minimumTrustLevel: verified
allowedRoles:
  - developer
  - admin

agentPolicies:
  - agentId: code-modifier
    allowedRoles: [developer, admin]
    requireDeviceTrust: verified

skillPolicies:
  - skillId: shell-exec
    dangerous: true
    requiredPermissions: [skill:execute]
    allowedRoles: [developer]
```

### Security Checks

```typescript
// Check permission
const result = await securityService.checkPermission(context, "task:submit");

if (!result.allowed) {
  throw new Error(result.reason);
}

// Check agent access
const agentAccess = await securityService.checkAgentAccess(context, "code-modifier");

// Check skill access
const skillAccess = await securityService.checkSkillAccess(context, "shell-exec");
```

### Audit Logging

All actions are audited:

```typescript
await securityService.audit({
  action: "task.submit",
  userId: user.id,
  sessionId: session.sessionId,
  resourceType: "task",
  resourceId: task.id,
  result: "allowed",
});

// Query audit logs
const logs = await securityService.getAuditLog({
  userId: "user-123",
  action: "task.submit",
  startDate: new Date("2024-01-01"),
});
```

## 4. Remote Orchestration

### Multi-Session Isolation

Each remote session is isolated:

- Separate task queues
- Independent memory scope
- Per-session permissions
- Session-specific audit trail

### Secure Streaming

Task updates stream securely:

```typescript
// Client subscribes to task updates
for await (const update of runtime.streamTaskUpdates(taskId)) {
  // Real-time status updates
  handleUpdate(update);
}
```

### Remote Command Execution

```typescript
// Remote task submission
const task = await runtime.submitTask({
  description: "Run tests",
  input: "npm test",
  sessionId: remoteSessionId,
  metadata: {
    source: "ci-pipeline",
    trigger: "pull-request",
  },
});
```

## 5. Deployment Modes

### Local-Only Mode

Default single-machine setup (backward compatible with CoderClaw):

```typescript
const runtime = new CoderClawRuntime(new LocalTransportAdapter(context), "local-only");
```

### Remote-Enabled Mode

Accepts remote connections with authentication:

```typescript
const runtime = new CoderClawRuntime(new HTTPTransportAdapter(config), "remote-enabled");
```

### Distributed Cluster Mode

Full distributed deployment (future):

```typescript
const runtime = new CoderClawRuntime(new ClusterTransportAdapter(config), "distributed-cluster");
```

## 6. Team & Enterprise Features

### Shared Agent Registries

Teams can share custom agents:

```yaml
# team-agents.yaml
agents:
  - id: team-reviewer
    name: Team Code Reviewer
    description: Enforces team standards
    capabilities: [review, lint, format]
```

### Centralized Skill Distribution

Skills can be distributed team-wide:

```bash
# Install team skill
coderclaw skill install team/security-scanner --registry team-registry
```

### Team-Wide Policy Enforcement

```yaml
# team-policy.yaml
organizationPolicy:
  enforceTrust: true
  minimumTrustLevel: verified
  requiredSkills: [security-scanner]
  deniedSkills: [dangerous-exec]
```

### CI Integration

```yaml
# .github/workflows/ai-review.yml
- name: Run AI Code Review
  uses: coderclaw/action@v2
  with:
    task: "Review pull request"
    agent: "code-reviewer"
    mode: "remote-enabled"
```

## 7. Configuration

### Runtime Configuration

```yaml
# .coderClaw/runtime.yaml
mode: remote-enabled

transport:
  type: local
  enabled: true

security:
  enforceTrust: true
  requireAuth: true
  defaultRoles: [developer]

deployment:
  mode: remote-enabled
  allowRemoteSessions: true
  maxConcurrentTasks: 10
```

### Security Configuration

```yaml
# .coderClaw/security.yaml
identity:
  providers:
    - oidc
    - github

deviceTrust:
  minimumLevel: verified
  autoTrustLocal: true

roles:
  custom-developer:
    inherits: developer
    additionalPermissions:
      - config:write
```

## 8. Best Practices

### Security

1. **Always enforce device trust** in production
2. **Use repo-level policies** to restrict dangerous operations
3. **Enable audit logging** for compliance
4. **Rotate session tokens** regularly
5. **Review audit logs** periodically

### Performance

1. **Use appropriate deployment mode** for your scale
2. **Configure task timeouts** to prevent resource exhaustion
3. **Monitor active task count** and set limits
4. **Implement graceful shutdown** for long-running tasks

### Operations

1. **Test security policies** in staging environment
2. **Document custom roles and permissions** for your team
3. **Maintain audit trail** for security incidents
4. **Implement monitoring** for task execution metrics

## 9. Migration Guide

### From Phase 1 to Phase 2

Phase 2 is backward compatible with Phase 1:

```typescript
// Phase 1: Direct orchestrator usage
import { globalOrchestrator } from "coderclaw/coderclaw";
const workflow = globalOrchestrator.createWorkflow(steps);

// Phase 2: Enhanced orchestrator with transport
import { globalEnhancedOrchestrator } from "coderclaw/coderclaw/orchestrator-enhanced";
const workflow = globalEnhancedOrchestrator.createWorkflow(steps);
```

Existing code continues to work. New features are opt-in:

- Transport adapters (optional)
- Security policies (defaults to permissive)
- Remote orchestration (disabled by default)

## 10. API Reference

API documentation:

- Transport API (`src/transport/`)
- Security API (`src/security/`)
- Task Engine API (`src/transport/task-engine.ts`)

## 11. Examples

See the `examples/phase2/` directory for:

- Remote task submission
- Security policy configuration
- Custom transport adapter implementation
- CI/CD integration
- Team collaboration setup
