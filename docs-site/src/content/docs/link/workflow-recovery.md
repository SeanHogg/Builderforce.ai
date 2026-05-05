---
title: Workflow Recovery and Debugging
description: How CoderClaw checkpoints multi-step workflows, how to resume after failure, and how to diagnose stuck or misbehaving workflows
---

# Workflow Recovery and Debugging

Multi-step workflows can fail partway through — the model times out, a tool call errors, the machine loses power, or an approval gate is rejected. CoderClaw checkpoints each step as it completes so that you can resume from the last safe point rather than starting over.

---

## Workflow checkpoints

Every workflow run writes a YAML checkpoint file under `.coderClaw/sessions/`:

```
.coderClaw/
  sessions/
    workflow-orchestration-20260321-095412.yaml
    workflow-planning-20260320-143001.yaml
```

The checkpoint is updated after each step completes. If the process crashes mid-step, the checkpoint reflects the last successfully completed step.

### Checkpoint schema

```yaml
workflowId: orchestration-20260321-095412
workflowType: planning
status: in_progress          # pending | in_progress | completed | failed
startedAt: "2026-03-21T09:54:12.000Z"
completedAt: null
projectRoot: /home/sean/projects/builderforce

steps:
  - stepIndex: 0
    role: planner
    description: "Break down the feature into tasks"
    status: completed        # pending | running | completed | failed | skipped
    startedAt: "2026-03-21T09:54:13.000Z"
    completedAt: "2026-03-21T09:57:45.000Z"
    output: "Generated 6 tasks..."

  - stepIndex: 1
    role: coder
    description: "Implement the API endpoint"
    status: failed
    startedAt: "2026-03-21T09:57:46.000Z"
    completedAt: "2026-03-21T09:59:01.000Z"
    error: "TypeScript compilation error: TS2345 at src/api/export.ts:42"

  - stepIndex: 2
    role: reviewer
    description: "Review the implementation"
    status: pending
    startedAt: null
    completedAt: null
```

---

## Resuming a failed workflow

To resume from the last completed step:

```bash
coderclaw workflow resume workflow-orchestration-20260321-095412
```

CoderClaw reads the checkpoint, skips all `completed` steps, and re-runs from the first `failed` or `pending` step.

### Skipping a failed step

If you want to skip the failed step and continue from the next one:

```bash
coderclaw workflow resume workflow-orchestration-20260321-095412 --skip-failed
```

Use this when the failure was a non-critical step (e.g. a linting step that errored on a pre-existing issue) and you want the workflow to continue regardless.

### Re-running from a specific step

```bash
coderclaw workflow resume workflow-orchestration-20260321-095412 --from-step 1
```

This re-runs step 1 and all subsequent steps, discarding the previous output from those steps.

---

## Diagnosing workflow failures

### Check the checkpoint file

The checkpoint is the fastest way to see what failed:

```bash
cat .coderClaw/sessions/workflow-orchestration-20260321-095412.yaml
```

Look for `status: failed` steps and their `error` field.

### Check the telemetry log

The JSONL telemetry file has span-level detail for every step:

```bash
jq 'select(.kind == "task.fail") | {role: .data.role, error: .data.error}' \
  .coderClaw/telemetry/2026-03-21.jsonl
```

### Check the tool audit log

The tool audit log (written to the portal when connected) records every tool call the agent made, including inputs, outputs, and errors. Check it from the Builderforce portal under the claw detail panel → **Tool Audit** tab. Before re-running a workflow that produced unexpected output, read the tool audit log — it is the authoritative record of what the agent actually did.

### Check session chat history

Each workflow step runs in its own session. The session key is `wf-<workflowId>-step-<index>`. To review the agent's reasoning for a specific step:

```bash
coderclaw sessions get wf-orchestration-20260321-095412-step-1
```

---

## Stuck workflows

A workflow is "stuck" when its status is `in_progress` but no step has progressed for an extended time. Common causes:

| Cause | Symptom | Fix |
|-------|---------|-----|
| Approval gate pending | Checkpoint shows `running` step with `requiresApproval: true` | Approve or reject in the portal |
| Model timeout | Step has been `running` for >10 minutes | Cancel and resume — the step will retry |
| Remote claw offline | `remote:auto` step can't find a matching claw | Bring the target claw online, then resume |
| Infinite tool loop | Step is `running` but consuming tokens with no progress | Check tool audit log; cancel and revise the step description |

To cancel a running workflow:

```bash
coderclaw workflow cancel workflow-orchestration-20260321-095412
```

This sets the workflow status to `failed` in both the checkpoint and the portal (if connected).

---

## Workflow status in the portal

When connected to Builderforce, workflow status is synced live. The [Workflows](/link/multi-agent-orchestration/) page shows:

- All workflows and their current status
- Per-step status, role, and timing
- Link to the spec that generated the workflow (if created from a spec)
- Ability to manually mark a workflow as `failed` or `cancelled`

If a workflow is stuck in `in_progress` in the portal but the claw has already finished, use `PATCH /api/workflows/:id` to manually update the status.

---

## Idempotency and re-runs

Workflows are designed to be re-run safely. Each step's output is saved in the checkpoint before the next step begins. However:

- **Tool side effects are not rolled back.** If a step created a file, made an API call, or pushed a commit before failing, those side effects persist on re-run.
- **Remote dispatch results are cached per correlationId.** If a remote step completed before the failure, its result is replayed on resume rather than re-dispatched.

For destructive workflows (database migrations, production deploys), review the checkpoint and tool audit log before resuming to confirm what has already been applied.
