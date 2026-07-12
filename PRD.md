> **PRD** — drafted by John Coder ((V2) (Durable)) · task #618
> _Each agent that updates this PRD signs its change below._

# PRD: MCP Task Activity & Agent Role Surface

## Problem & Goal

### Problem

When an orchestrating agent inspects a task, it cannot determine — in a single MCP call — whether a coder has actually executed against that task, what that execution produced, or how recently it happened. Answering the question *"has real implementation work occurred here?"* currently requires stitching together three or more separate MCP calls (`executions.list_for_task`, trace fetch, `file_changes`), and even then the **agent role** (coder, PM, BA, validator, tester) that authored a PR or last touched the ticket is not surfaced at all.

This gap causes false confidence in task status. A task marked `done` or `in_review` may have been closed by a PM writing a PRD with no coder ever running — a condition that is currently undetectable without expensive multi-hop reasoning.

### Goal

Surface a concise, pre-computed **task activity signal** via MCP so any agent can answer the following questions in a single tool call, with no downstream aggregation required:

- Has a coder ever executed on this task?
- Did that execution produce code (non-doc file changes)?
- When did it last happen?
- Who (agent ref + role) opened or last updated the PR?
- Is this task stalling or falsely closed?

---

## Target Users / ICP Roles

| Consumer | How they use this |
|---|---|
| **Orchestrator / Brain agent** | Decides whether to re-queue a task, escalate, or trust its `done` status |
| **Validator / Tester agent** | Gates PR acceptance on confirmed coder execution producing real code |
| **PM / BA agent** | Detects tasks where spec work is complete but implementation has not started |
| **Human engineering lead** (secondary) | Reviews MCP-powered dashboards for stalled or zombie tasks |

---

## Scope

This capability covers read-only activity metadata attached to a task. It does **not** change task state, trigger re-execution, or modify PR metadata directly.

---

## Functional Requirements

### FR-1 — `tasks.get_activity` tool (new) or `tasks.get` enrichment

A single MCP-accessible entry point must return the following payload for any given `task_id`:

```
taskActivity {
  taskId:                    string
  lastExecutionAt:           ISO-8601 timestamp | null
  lastExecutionAgentRef:     string | null          // agent identifier
  lastExecutionAgentRole:    enum(coder, pm, ba, validator, tester, unknown)
  executionsCount:           integer                // total executions across all agents
  coderExecutionsCount:      integer                // executions where role == coder
  lastCoderRunAt:            ISO-8601 timestamp | null
  lastCoderRunProducedCode:  bool | null            // null if no coder run exists
  prOpenedByAgentRef:        string | null
  prOpenedByAgentRole:       enum(coder, pm, ba, validator, tester, unknown) | null
  prLastUpdatedByAgentRef:   string | null
  prLastUpdatedByAgentRole:  enum(coder, pm, ba, validator, tester, unknown) | null
  stalenessFlag:             bool
  stalenesReason:            string | null          // human-readable, e.g. "in_review but no coder execution has produced code"
}
```

### FR-2 — Role classification for agent executions

Each execution record must carry a resolved `agentRole` enum value. Role is determined by:

1. Agent self-declared role in its registration metadata (authoritative).
2. Fallback: heuristic based on agent name/ref pattern (e.g. `coder-*`, `pm-*`).
3. Final fallback: `unknown`.

Role resolution must be stable across calls for the same execution record.

### FR-3 — `lastCoderRunProducedCode` rollup

This boolean is computed as:

- `true` — the most recent coder execution resulted in ≥ 1 file change where the file extension or path is **not** exclusively documentation (`.md`, `.txt`, `.rst`, `docs/`, `wiki/`).
- `false` — the most recent coder execution produced only doc-type file changes, or produced zero file changes.
- `null` — no coder execution on record.

Doc vs. non-doc classification uses a configurable extension/path exclusion list (see Out of Scope for schema governance).

### FR-4 — PR authorship attribution

For each PR linked to the task:

- `prOpenedByAgentRef` and `prOpenedByAgentRole` are populated from the execution that triggered the PR creation event.
- `prLastUpdatedByAgentRef` and `prLastUpdatedByAgentRole` reflect the most recent execution that pushed commits or comments to the PR.
- If the PR was opened by a human (no agent ref), both fields are `null` and `prOpenedByAgentRole` is omitted.

### FR-5 — Staleness flag

`stalenessFlag` is set to `true` when **any** of the following conditions hold:

| Condition | `stalenessReason` value |
|---|---|
| Task status is `in_review` or `done` AND `lastCoderRunProducedCode` is `false` or `null` | `"status_advanced_without_coder_code_output"` |
| Task status is `in_review` or `done` AND `prOpenedByAgentRole != coder` AND `coderExecutionsCount == 0` | `"pr_opened_by_non_coder_no_coder_run"` |
| Task status is `in_progress` AND `lastExecutionAt` is > 24 h ago AND `coderExecutionsCount == 0` | `"in_progress_no_coder_activity"` |

Multiple conditions may be true simultaneously; `stalenessReason` returns the highest-priority match (order as listed above).

### FR-6 — Integration with `tasks.get`

`tasks.get` must include a `activitySummary` sub-object containing at minimum:

- `lastExecutionAt`
- `lastExecutionAgentRole`
- `lastCoderRunProducedCode`
- `stalenessFlag`

Full detail is available via `tasks.get_activity`. This avoids bloating every `tasks.get` response while still making the signal zero-hop for common orchestrator checks.

### FR-7 — Feed into validator / #615 gate

`stalenessFlag: true` with reason `status_advanced_without_coder_code_output` or `pr_opened_by_non_coder_no_coder_run` must be consumable as a structured signal by the validator sweep (ticket #615). No additional MCP call should be required by the validator to make a gate decision.

---

## Acceptance Criteria

### AC-1 — Single-call activity retrieval

`tasks.get_activity(taskId)` returns a valid `taskActivity` object with all required fields populated (or explicit `null` where no data exists) in ≤ 1 MCP round trip. No caller-side aggregation across multiple tools is required.

### AC-2 — Role surfaced on PR

Given a task where the only PR was opened by a PM agent with no subsequent coder execution:

- `prOpenedByAgentRole == "pm"`
- `coderExecutionsCount == 0`
- `lastCoderRunProducedCode == null`
- `stalenessFlag == true`
- `stalenessReason == "pr_opened_by_non_coder_no_coder_run"`

This state is directly detectable by an agent reading `tasks.get_activity` without additional calls.

### AC-3 — Staleness flag correctness

A task with status `done` where the sole execution was by a coder that committed only `.md` files:

- `lastCoderRunProducedCode == false`
- `stalenessFlag == true`
- `stalenessReason == "status_advanced_without_coder_code_output"`

A task with status `done` where a coder committed at least one `.py` file:

- `lastCoderRunProducedCode == true`
- `stalenessFlag == false`

### AC-4 — `tasks.get` includes activity summary

`tasks.get` response includes `activitySummary` containing `lastExecutionAt`, `lastExecutionAgentRole`, `lastCoderRunProducedCode`, and `stalenessFlag`. Existing `tasks.get` callers are unaffected (additive field only).

### AC-5 — Role enum completeness

All execution records in the system, including historical records pre-dating this feature, return a resolved `agentRole`. Records with no deterministic role signal return `"unknown"` — never an error or missing field.

### AC-6 — Validator gate compatibility

The validator agent for task #615 can read `stalenessFlag` and `stalenessReason` from `tasks.get_activity` and make a binary gate decision (pass/block) without calling `executions.list_for_task`, trace APIs, or `file_changes` directly.

### AC-7 — Performance

`tasks.get_activity` p95 latency ≤ 300 ms for tasks with up to 500 execution records. Activity fields in `tasks.get` add ≤ 50 ms to existing p95 baseline.

---

## Out of Scope

- **Write operations**: this capability is read-only. Re-queuing, reassigning, or changing task status based on staleness is handled by the orchestrator consuming this signal, not by this tool.
- **Doc/non-doc exclusion list governance**: the configurable extension/path list for `lastCoderRunProducedCode` classification is managed via a separate configuration schema ticket; this PRD assumes a reasonable static default list at launch.
- **Human-authored PR attribution**: PRs opened manually by humans (no agent ref) are surfaced as `null` role fields and are explicitly out of scope for role-based staleness logic.
- **Real-time push / webhooks**: activity data is available on-demand via MCP pull only. Streaming or push notification of staleness changes is a future capability.
- **Cross-task rollups**: aggregate views (e.g., "all stale tasks in sprint") are out of scope; this PRD covers per-task signals only.
- **Execution content analysis beyond file changes**: the tool does not parse code quality, test coverage, or semantic correctness of outputs. It signals whether non-doc files were changed, not whether those changes are correct.
- **Backfill SLA**: historical execution records missing role metadata will return `"unknown"` — a backfill migration to resolve historical roles is a separate ops task.