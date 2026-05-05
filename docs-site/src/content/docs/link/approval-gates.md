---
title: Approval Gates (Human-in-the-Loop)
description: How CoderClaw blocks on human approval before executing high-risk actions — and how Builderforce manages the approval workflow
---

# Approval Gates — Human-in-the-Loop Control

CoderClaw supports **approval gates**: agent-initiated pauses that block execution until a human approves or rejects the pending action. This is separate from the local exec-approval system (which governs which shell commands are allowed). Approval gates apply to higher-level agentic decisions — destructive operations, production deployments, large-scale refactors, or anything your team has decided needs a human sign-off.

> **Exec approvals vs approval gates**
>
> - **Exec approvals** (`coderclaw approvals`) — allowlist for shell commands that the agent may run without prompting. Local, filesystem-managed.
> - **Approval gates** (this page) — Builderforce-mediated pauses for significant agentic actions. Require portal connectivity; auto-approve in standalone mode.

---

## How it works

When an agent calls `requestApproval()` internally (or a tool explicitly triggers a gate):

1. CoderClaw POSTs an approval request to Builderforce:
   ```
   POST /api/claws/:id/approval-request
   ```
2. The portal creates a pending approval record and pushes an `approval.request` frame to the relay WebSocket — which surfaces in the Builderforce UI as a notification.
3. The claw **blocks** on that approval, waiting for an `approval.decision` relay frame.
4. A manager or owner in the portal reviews the request and clicks **Approve** or **Reject**.
5. The decision arrives via the relay; the claw unblocks and continues (or aborts) accordingly.

### Timeout

Approval requests time out after 10 minutes by default. A timed-out request resolves as `"timeout"` and the agent treats it as a rejection.

---

## Standalone mode (no Builderforce)

If CoderClaw is running without a Builderforce connection, approval gates **auto-approve**. The agent logs a warning:

```
[approval-gate] No Builderforce connection — auto-approving: deploy production database migration
```

This means standalone mode is fully autonomous. If you need enforced gates without the portal, use the local exec-approval allowlist to restrict dangerous shell commands instead.

---

## Requesting approval in a workflow

In a workflow YAML, mark a step as requiring approval by adding `requiresApproval: true`:

```yaml
# .coderClaw/workflows/deploy.yaml
steps:
  - role: planner
    description: "Plan the deployment sequence"

  - role: coder
    description: "Apply database migrations"
    requiresApproval: true   # blocks until portal approval

  - role: coder
    description: "Deploy application to production"
    requiresApproval: true
```

Alternatively, any agent tool can call `requestApproval()` directly with a custom action type and description.

### Action types

| Action type | Typical use |
|-------------|-------------|
| `database_migration` | Schema changes, destructive migrations |
| `production_deploy` | Deploying to a live environment |
| `secret_rotation` | Rotating credentials or API keys |
| `bulk_delete` | Deleting many records or files |
| `external_api_call` | Calling a third-party API with side effects |
| `custom` | Any other action you define |

---

## Managing approvals in the portal

Navigate to [Approvals](/link/api-reference/#approvals-human-in-the-loop) in the Builderforce portal:

- **Pending** — requests waiting for a decision (highlighted, notify badge)
- **Approved** — decisions that allowed the agent to proceed
- **Rejected** — decisions that caused the agent to abort
- **Timed out** — requests that expired before a human responded

Each approval record shows: action type, description, requesting claw, timestamp, and any reviewer note left on the decision.

### Who can approve?

Approval decisions require the **MANAGER** role or higher. Viewers and developers see the approval list but cannot decide.

---

## API reference

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/claws/:id/approval-request` | Claw key | Create pending approval from agent |
| `GET` | `/api/approvals` | JWT | List approvals (`?status=&clawId=`) |
| `GET` | `/api/approvals/:id` | JWT | Get approval detail |
| `PATCH` | `/api/approvals/:id` | JWT, MANAGER+ | Approve or reject |

### Relay frames

**Portal → claw** (after decision):
```json
{
  "type": "approval.decision",
  "approvalId": "apr_abc123",
  "status": "approved",
  "reviewNote": "Verified migration script — proceed"
}
```

**Claw → portal** (on request):
```json
{
  "type": "approval.request",
  "approvalId": "apr_abc123",
  "actionType": "database_migration",
  "description": "Apply migration 0042_add_audit_table.sql to production"
}
```

---

## Best practices

**Set meaningful descriptions.** A manager seeing "Are you sure?" in the portal has no context. A description like "Apply migration 0042_add_audit_table.sql — adds 3 new tables, no destructive changes" lets them decide confidently.

**Use action types consistently.** Consistent types let you filter the approval log by category and spot patterns in what your agents are requesting.

**Keep gates at decision boundaries, not every tool call.** Gate the "deploy to production" step, not every file write. Too many gates train reviewers to click approve without reading.

**Monitor timed-out approvals.** A timeout means a manager wasn't watching. Set up portal notification hooks (when available) or check the approvals list regularly during active agent runs.
