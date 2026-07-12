> **PRD** — drafted by John Coder ((V2) (Durable)) · task #618
> _Each agent that updates this PRD signs its change below._

# PRD: Task Execution & Agent Activity Surface (MCP)

## Problem & Goal

### Problem
When an orchestrating agent reviews a task marked `in_review` or `done`, it cannot quickly determine *who* actually worked the task, *what* they produced, or *when* the last meaningful activity occurred. Reconstructing this requires stitching together results from `executions.list_for_task`, trace lookups, and `file_changes` — multiple round-trips that still do not expose the **agent role** (coder, PM, BA, validator, tester) that opened or last updated a PR.

The practical failure mode: a task is flagged "100% done" but a PM or BA authored the PR (writing docs or a PRD), no coder ever ran, and no code was produced. This is invisible to downstream gates and validator sweeps.

### Goal
Surface a concise, single-call activity signal per task that lets any agent — in one MCP tool response — answer:
- Has a **coder** ever executed on this task?
- Did that execution produce **code** (not just docs)?
- **When** was the last execution, and by **whom** (agent ref + role)?
- Is this task **stalling** — open PR, but no qualifying coder run?

---

## Target Users / ICP Roles

| Consumer | Need |
|---|---|
| **Orchestrator / PM agent** | Determine whether a task is genuinely implemented before marking done or escalating |
| **Validator / QA agent** | Gate on `lastCoderRunProducedCode` before approving a PR |
| **Accounting / billing agent** | Correlate execution cost to role type; detect ghost completions (#615) |
| **Human engineering lead** | Audit task history without manually querying execution traces |

---

## Scope

### In Scope
- A new MCP tool **`tasks.get_activity`** (preferred) **or** augmenting the existing `tasks.get` response with an `activity` block
- Role classification for known agent archetypes: `coder | pm | ba | validator | tester | unknown`
- File-output classification: `code | docs | config | mixed | none`
- A computed `staleness` flag with a defined triggering condition
- PR authorship role exposure (who opened / last updated the linked PR)
- Rollup fields usable as gate inputs by downstream agents without further API calls

### Out of Scope
- Changes to how executions are stored or traced (read-only aggregation layer)
- Role *assignment* or agent identity management
- UI/dashboard rendering of this data
- Diff-content summarization (covered by the diff-summary capability ticket)
- Progress breakdown scoring (covered by the progress-breakdown capability ticket)

---

## Functional Requirements

### FR-1 — `tasks.get_activity` Tool (or `activity` block on `tasks.get`)

The tool accepts a `task_id` and returns an `activity` object with the following fields:

```jsonc
{
  "taskId": "string",
  "activity": {
    // Execution rollup
    "executionsCount": "integer",           // total executions ever recorded for this task
    "lastExecutionAt": "ISO-8601 | null",   // timestamp of most recent execution (any role)
    "lastExecutionAgentRef": "string | null", // stable agent identifier
    "lastExecutionAgentRole": "coder | pm | ba | validator | tester | unknown | null",

    // Coder-specific rollup
    "lastCoderExecutionAt": "ISO-8601 | null",
    "lastCoderExecutionAgentRef": "string | null",
    "lastCoderRunProducedCode": "boolean | null", // null = no coder run ever recorded

    // Output classification of the last coder run
    "lastCoderRunOutputType": "code | docs | config | mixed | none | null",

    // PR authorship
    "prOpenedByAgentRef": "string | null",
    "prOpenedByAgentRole": "coder | pm | ba | validator | tester | unknown | null",
    "prLastUpdatedByAgentRef": "string | null",
    "prLastUpdatedByAgentRole": "coder | pm | ba | validator | tester | unknown | null",

    // Staleness
    "isStale": "boolean",
    "stalenessReasons": ["string"]  // human-readable list of triggered conditions
  }
}
```

### FR-2 — Agent Role Classification

- Role is derived from the agent's registered metadata (agent type tag or name pattern).
- If role cannot be determined, it resolves to `"unknown"` — never omitted or `null` except when no execution exists.
- Role classification must be consistent across `lastExecutionAgentRole`, `prOpenedByAgentRole`, and `prLastUpdatedByAgentRole`.

### FR-3 — Output-Type Classification

For the most recent coder execution, classify file changes as:

| Label | Condition |
|---|---|
| `code` | ≥1 file changed with extension in the registered code-extension set (`.py`, `.ts`, `.js`, `.go`, `.rs`, `.java`, `.rb`, `.cs`, `.cpp`, `.c`, `.swift`, `.kt`, etc.) |
| `docs` | All changed files are `.md`, `.txt`, `.rst`, `.adoc`, or files under `docs/` |
| `config` | All changed files are config/infra types (`.yaml`, `.json`, `.toml`, `.env`, `.tf`, `.hcl`, etc.) |
| `mixed` | Changed files span more than one of the above categories |
| `none` | Execution recorded but zero file changes detected |

### FR-4 — Staleness Flag

`isStale` is `true` and `stalenessReasons` is populated when **any** of the following conditions are met:

| Condition ID | Trigger |
|---|---|
| `STALE_NO_CODER_RUN` | Task status is `in_review` or `done` and `lastCoderExecutionAt` is `null` |
| `STALE_CODER_NO_CODE` | Task status is `in_review` or `done` and `lastCoderRunProducedCode` is `false` |
| `STALE_PR_BY_NON_CODER` | A PR is linked and `prOpenedByAgentRole` is not `coder` and no subsequent coder execution exists |
| `STALE_NO_ACTIVITY` | Task status is `in_review` or `done` and `lastExecutionAt` is more than `N` hours ago (default `N = 48`, configurable per workspace) |

Each triggered condition appends a short human-readable string to `stalenessReasons`, e.g.:
- `"Task is in_review but no coder execution has ever run"`
- `"PR was opened by a pm agent; no coder has executed since"`

### FR-5 — Integration Points

- `lastCoderRunProducedCode: false` **or** `isStale: true` MUST be usable as a boolean gate input by the validator sweep and the #615 accounting fix without any additional API calls.
- The `activity` block MUST be includable in `tasks.list` responses via an opt-in parameter (`include_activity: true`) to avoid payload bloat on bulk queries.

---

## Acceptance Criteria

### AC-1 — Execution Rollup Fields Present
Given a task with at least one recorded execution, `tasks.get_activity` returns non-null values for `executionsCount`, `lastExecutionAt`, `lastExecutionAgentRef`, and `lastExecutionAgentRole`.

### AC-2 — Coder Run Detection
Given a task where a coder agent has executed, `lastCoderExecutionAt` and `lastCoderExecutionAgentRef` reflect that run, and `lastCoderRunProducedCode` is `true` if any code-extension file was changed.

### AC-3 — "PR by Non-Coder, Never Implemented" Detection
Given a task with a linked PR opened by a PM agent and zero coder executions:
- `prOpenedByAgentRole = "pm"`
- `lastCoderExecutionAt = null`
- `lastCoderRunProducedCode = null`
- `isStale = true`
- `stalenessReasons` contains the `STALE_PR_BY_NON_CODER` message

### AC-4 — Staleness on Done with No Code
Given a task in status `done` where all executions were by a BA and produced only `.md` files:
- `lastCoderRunProducedCode = null`
- `isStale = true`
- `stalenessReasons` contains both `STALE_NO_CODER_RUN` and `STALE_CODER_NO_CODE` conditions

### AC-5 — Single Call Sufficiency
An orchestrator agent MUST be able to determine task legitimacy (coder ran + produced code + not stale) using only the response from `tasks.get_activity` — no follow-up calls to `executions.list_for_task`, trace, or `file_changes` required.

### AC-6 — Bulk List Opt-In
`tasks.list` with `include_activity: true` returns the `activity` block for each task. Without the flag, `activity` is absent from list responses.

### AC-7 — No Coder Run Null Safety
When zero executions exist for a task, all `lastCoder*` fields are `null`, `lastCoderRunProducedCode` is `null` (not `false`), and `executionsCount` is `0`. No fields are omitted.

### AC-8 — Role Classification Consistency
The same agent ref resolves to the same role value in `lastExecutionAgentRole`, `prOpenedByAgentRole`, and `prLastUpdatedByAgentRole` within the same response.

---

## Out of Scope

- **Writing or mutating execution records** — this capability is read-only aggregation
- **Agent identity provisioning or role assignment** — roles are read from existing agent metadata
- **Diff content summarization** — covered by the diff-summary capability ticket
- **Progress percentage or breakdown scoring** — covered by the progress-breakdown capability ticket
- **Notification or alerting on staleness** — consumers poll; no push/webhook in this ticket
- **UI rendering** — API/MCP surface only
- **Historical role changes** — role is resolved at query time from current agent metadata; past role changes are not tracked
- **Cross-task or project-level rollups** — per-task only; aggregate dashboards are out of scope