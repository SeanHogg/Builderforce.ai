# Phase 2 Examples

This directory contains examples demonstrating BuilderForce Agents Phase 2 features.

## Prerequisites

```bash
# Install dependencies
npm install

# Build the project
npm run build
```

## Running Examples

### 1. Basic Task Submission

Demonstrates the transport abstraction layer and task submission:

```bash
npx tsx examples/phase2/basic-task-submission.ts
```

**Features shown:**

- Creating a runtime with local transport adapter
- Getting runtime status
- Listing available agents and skills
- Submitting tasks
- Streaming task updates
- Querying task state

### 2. Security & RBAC

Demonstrates the security model with role-based access control:

```bash
npx tsx examples/phase2/security-rbac.ts
```

**Features shown:**

- User authentication
- Device verification and trust levels
- Session creation with roles
- Permission checking
- Repo-level policy enforcement
- Agent and skill access control
- Audit logging

### 3. Task Lifecycle

Demonstrates the distributed task engine and state machine:

```bash
npx tsx examples/phase2/task-lifecycle.ts
```

**Features shown:**

- Creating multiple related tasks
- State machine transitions (pending → planning → running → completed)
- Progress tracking
- Task waiting and resumption
- Task failure handling
- Task cancellation
- Event history
- State transition validation

## Example Output

### Basic Task Submission

```
=== BuilderForce Agents Phase 2 Example ===

Runtime Status:
  Mode: local-only
  Version: 2026.2.20
  Active Tasks: 0
  Total Tasks: 0

Available Agents:
  - General Purpose Agent (general-purpose)
    Full-capability agent for complex tasks
  - Explore Agent (explore)
    Fast agent for codebase exploration
  - Task Agent (task)
    Agent for executing commands

Available Skills:
  - Coding Agent (coding-agent)
    Version: 1.0.0, Enabled: true
  - GitHub Integration (github-integration)
    Version: 1.0.0, Enabled: true

Submitting task...
Task created: 123e4567-e89b-12d3-a456-426614174000
Status: pending

Monitoring task progress:
  [2024-01-15T10:30:00.000Z] Status: pending
  [2024-01-15T10:30:01.000Z] Status: planning
  [2024-01-15T10:30:02.000Z] Status: running
  [2024-01-15T10:30:10.000Z] Status: completed

Final Task State:
  Status: completed
  Created: 2024-01-15T10:30:00.000Z
  Completed: 2024-01-15T10:30:10.000Z
  Output: Task completed successfully

Example complete!
```

### Security & RBAC

```
=== BuilderForce Agents Phase 2 Security Example ===

1. Authenticating user...
   User authenticated: Developer (user-123)

2. Verifying device...
   Device: laptop-001
   Trust Level: untrusted

3. Creating session...
   Session: session-456
   Roles: developer

4. Getting effective permissions...
   Permissions:
     - task:submit
     - task:read
     - task:cancel
     - agent:invoke
     - skill:execute

5. Checking permissions...
   task:submit: ✓ Allowed
   config:write: ✗ Denied
   Reason: Missing required permission: config:write

6. Setting up repo policy...
   Repo policy set for: /projects/example

7. Checking agent access...
   code-modifier agent: ✗ Denied
   Reason: Agent code-modifier requires trusted device

8. Checking skill access...
   shell-exec skill: ✗ Denied
   Reason: Skill shell-exec is dangerous and requires trusted device

9. Recording audit log...
   Audit entry recorded

10. Querying audit log...
   Found 1 audit entries
   - 2024-01-15T10:35:00.000Z: task.submit (allowed)

Example complete!
```

### Task Lifecycle

```
=== BuilderForce Agents Phase 2 Task Lifecycle Example ===

1. Creating tasks...
   Task 1: abc-123 (pending)
   Task 2: def-456 (pending)
   Task 3: ghi-789 (pending)

2. Executing task 1...
   Status: planning
   Status: running
   Progress: 50%
   Progress: 100%
   Status: completed

3. Executing task 2...
   Progress: 30%
   Status: waiting (external input required)
   Status: running (resumed)
   Status: completed

4. Executing task 3 (with failure)...
   Progress: 20%
   Status: failed (Test framework configuration error)

5. Listing all tasks:
   - Analyze requirements
     ID: abc-123
     Status: completed
     Progress: 100%
     Output: Requirements analyzed successfully
   - Implement feature
     ID: def-456
     Status: completed
     Progress: 100%
     Output: Feature implemented
   - Write tests
     ID: ghi-789
     Status: failed
     Progress: 20%
     Error: Test framework configuration error

6. Listing completed tasks:
   Found 2 completed tasks
   - Analyze requirements (abc-123)
   - Implement feature (def-456)

7. Task 2 event history:
   [2024-01-15T10:40:00.000Z] created: Task created
   [2024-01-15T10:40:01.000Z] status_changed: Status changed from pending to planning
   [2024-01-15T10:40:02.000Z] status_changed: Status changed from planning to running
   [2024-01-15T10:40:03.000Z] progress_updated:
   [2024-01-15T10:40:04.000Z] status_changed: Status changed from running to waiting
   [2024-01-15T10:40:05.000Z] status_changed: Status changed from waiting to running
   [2024-01-15T10:40:06.000Z] progress_updated:
   [2024-01-15T10:40:07.000Z] output_added:
   [2024-01-15T10:40:08.000Z] status_changed: Status changed from running to completed

8. Creating and cancelling a task...
   Task 4 created and running
   Task 4 cancelled: true
   Status: cancelled

9. Testing invalid state transition...
   ✓ Invalid transition blocked: Invalid status transition from pending to completed for task jkl-012

Example complete!
```

## Understanding the Examples

### Transport Abstraction

The transport layer provides a protocol-agnostic interface. The examples use `LocalTransportAdapter`, but you can implement custom adapters for:

- HTTP/REST
- WebSocket
- gRPC
- Custom protocols

### Security Model

The security examples show the layered approach:

1. **Identity**: Who is making the request?
2. **Device Trust**: Is the device trusted?
3. **Roles & Permissions**: What can they do?
4. **Policies**: What are the constraints?
5. **Audit**: What happened?

### Task Lifecycle

Tasks follow a strict state machine:

- Only valid transitions are allowed
- All state changes are audited
- Progress can be tracked
- Tasks can be resumed after waiting
- Invalid transitions are rejected

## Next Steps

- Read the [Phase 2 documentation](../../docs/phase2.md)
- Review the [API reference](../../docs/api/)
- Try modifying the examples to suit your needs
- Implement custom transport adapters
- Create custom security policies

## Troubleshooting

### "Module not found" errors

Make sure you've built the project:

```bash
npm run build
```

### Type errors

The examples use TypeScript. If you get type errors, ensure your TypeScript version is compatible:

```bash
npm install -g typescript@latest
```

### Import errors

The examples use ES modules. Make sure your `package.json` has `"type": "module"`.
