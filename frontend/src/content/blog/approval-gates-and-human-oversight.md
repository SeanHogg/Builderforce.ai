---
title: Approval Gates — Keeping Humans in Control of Agent Actions
date: 2026-03-10
description: How Builderforce.ai's approval gate system lets you define exactly which agent actions require human sign-off, block execution until a decision is made, and maintain a complete audit trail.
tags: [approval-gates, human-in-the-loop, governance, security, orchestration]
author: Sean Hogg
---

# Approval Gates — Keeping Humans in Control of Agent Actions

Autonomous agents are powerful. That is also exactly what makes them dangerous without the right guardrails. An agent that can push code, modify production config, or send messages on your behalf is extraordinarily useful — until it does something you did not intend.

Builderforce.ai's **approval gate** system solves this at the infrastructure level. You define which action types need human sign-off; the platform blocks execution until a manager approves or rejects; the agent only proceeds once the decision is recorded. The whole loop is audited.

---

## How Approval Gates Work

The flow has three participants: the **agent** (running inside CoderClaw), the **Builderforce portal** (where the approval is surfaced to a human), and the **manager** (a team member with the `MANAGER` role or above).

```
Agent runs a task
    │
    └─► "This action requires approval"
            │
            ▼
    POST /api/approvals ──────────────────────────────────────┐
            │                                                  │
            ▼                                                  ▼
    Agent suspends execution              Portal notifies manager
    (awaiting decision)                   via dashboard + relay push
            │                                                  │
            └──────────────── Manager approves/rejects ────────┘
                                          │
                             approval.decision pushed to claw
                                          │
                               ┌──────────▼──────────┐
                               │ approved → continue  │
                               │ rejected → abort     │
                               └──────────────────────┘
```

The key property: **execution is genuinely blocked**. The agent does not proceed, retry, or time out silently. It waits — up to a configurable timeout — for a real decision from a real person.

---

## The Approvals Page

Navigate to [/approvals](/approvals) to see your team's pending, approved, and rejected gates.

Each approval request shows:

| Field | Description |
|---|---|
| **Action type** | What the agent was trying to do (`git.push`, `deploy`, `task.execution`, etc.) |
| **Description** | The plain-English reason the agent gave |
| **Requested by** | Which CoderClaw instance submitted the request |
| **Requested at** | Timestamp of the request |
| **Expires at** | When the request will auto-timeout if unanswered |
| **Metadata** | Structured context (task ID, priority, file list, cost estimate, etc.) |

Approving or rejecting takes a single click. You can optionally add a **review note** that is recorded against the decision and visible in the audit log.

---

## What Triggers an Approval Gate

There are two sources:

### 1. Automatic Gates (Platform-Enforced)

The Builderforce runtime evaluates a gate automatically when a task is submitted for execution if:

- The task's **priority is `high` or `urgent`**

This is the default safety net — high-stakes tasks always get a human review before an agent starts executing.

### 2. Explicit Gates (Agent-Requested)

CoderClaw agents can request approval at any point during execution by calling `requestApproval()`:

```typescript
import { requestApproval } from "@coderclaw/approval-gate";

const decision = await requestApproval({
  actionType: "git.push",
  description: "Push 42 changed files to the main branch",
  metadata: {
    files: changedFiles,
    branch: "main",
    estimatedRisk: "high",
  },
  timeoutMs: 10 * 60 * 1000, // 10 minute window
});

if (decision !== "approved") {
  throw new Error(`Push not approved: ${decision}`);
}

await git.push("origin", "main");
```

The agent suspends at `await requestApproval(...)` until:
- A manager approves → returns `"approved"`
- A manager rejects → returns `"rejected"`
- The timeout expires → returns `"timeout"`

No polling, no manual re-checking — the decision is pushed to the claw the instant the manager acts.

---

## Role Requirements

Only users with the `MANAGER` or `OWNER` role can approve or reject gates. Viewers and developers can see pending approvals but cannot action them.

This is intentional. Approval authority is a governance control — it should map to the same people who have deploy access, not the whole team.

You can manage team roles from [Settings → Members](/settings).

---

## Notifications

When an approval request arrives, the manager sees it in three places:

1. **The portal** — the [Approvals](/approvals) badge updates in the sidebar in real time
2. **The relay** — if a browser session is open on the relevant claw's chat view, an `approval.request` event arrives immediately
3. **Messaging channels** (coming in Phase 2) — Slack, Telegram, email notifications for approval requests

---

## Audit Trail

Every approval decision is permanent and immutable. The [Audit Log](/admin) records:

- Who requested the approval (claw ID)
- Who made the decision (user ID)
- What the decision was and when
- The review note, if provided

This is your compliance trail. If a deployment went wrong and you need to know who approved it and why, this is where you look.

---

## Timeouts and Auto-Expiry

Approval requests have an optional `expiresAt` timestamp. When an approval expires:

- Its status moves to `expired`
- The awaiting agent receives a `"timeout"` decision
- The agent is responsible for deciding whether to abort or retry

The default CoderClaw timeout is 10 minutes for interactive agent requests. For longer-running background workflows, you can configure a longer window.

---

## Best Practices

**Define action types as a taxonomy.** Use consistent strings like `git.push`, `deploy.production`, `db.migrate`, `file.delete-bulk` rather than free-form descriptions. This makes the audit log filterable and lets you add automation rules later.

**Gate on risk, not frequency.** Not every action needs approval — only actions with meaningful blast radius. Write-to-production, destructive file operations, and external API calls that cost money or send communications are natural gate points.

**Keep approvals small.** A single approval request should describe one decision. "Push these 42 files" is actionable. "Do the whole deployment" is not — break it into checkpoints a manager can meaningfully review.

**Set realistic timeouts.** An agent blocked for 24 hours waiting for an approval that arrives at 9am is fine for low-urgency workflows. For live user-facing pipelines, use shorter timeouts with clear fallback behaviour.

---

## Next Steps

- Open [Approvals](/approvals) to see any pending gates on your team's claws
- Read [Task Execution and the Portal](/blog/task-execution-and-observability) to understand how approvals interact with the execution lifecycle
- See [Multi-Agent Orchestration](/blog/multi-agent-orchestration) for patterns that combine approval gates with multi-step workflows
