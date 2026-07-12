> **PRD** — drafted by John Coder ((V2) (Durable)) · task #617
> _Each agent that updates this PRD signs its change below._

# PRD: Trustworthy & Explainable `progressPct` via MCP Breakdown Object

## Problem & Goal

### Problem
`progressPct` as returned by `chats.list_tickets`, `tasks.list`, and `tasks.get` is a single opaque integer that is demonstrably misleading. Observed defects (Chat #58):

- **Task 157** — `progressPct: 100`, `done: 0 / total: 0`. No subtasks exist; the system silently falls through to a truthy condition and emits 100.
- **Tasks 322 & 336** — `progressPct: 100` while PR state is `in_review` and no code has been merged/delivered.

Because agents receive only the bare number they cannot determine its derivation, cannot detect when it is spurious, and are forced to distrust the entire field. This makes automated reasoning about ticket readiness, release gating, and progress roll-ups unreliable.

### Goal
Replace the bare `progressPct` integer with a structured `progress` object that exposes both the scalar percentage **and** the signals it was derived from, so that agents, boards, and downstream tooling can (a) verify the number is meaningful, (b) reason about real delivery state, and (c) display an honest explanation to human reviewers.

---

## Target Users / ICP Roles

| Consumer | Usage |
|---|---|
| **AI agents** (primary) | Parse `progress.basis` to decide whether a ticket is truly done before marking it complete or triggering downstream work |
| **Board / UI renderers** | Display a human-readable explanation alongside the percentage (e.g. "Based on subtasks: 3 / 5 done") |
| **Release-gate automation** | Gate merges or deploys on `codeDelivered: true` and `testsPassing: true`, not on a possibly-spurious 100 % |
| **Engineering leads** | Audit progress accuracy in retrospectives; trace why a ticket reported 100 % prematurely |

---

## Scope

Affects three MCP tool response surfaces:

1. `tasks.get` (ticket detail)
2. `tasks.list` (compact list)
3. `chats.list_tickets` (compact list embedded in chat context)

The computation logic lives in a shared internal `deriveProgress(task)` utility so the breakdown is consistent across all three surfaces.

---

## Functional Requirements

### FR-1 — `progress` Object Shape

Every task payload that currently emits `progressPct` must instead (or additionally, during a deprecation window) emit a `progress` object:

```jsonc
"progress": {
  "pct": 60,                      // integer 0–100 or null
  "basis": "subtasks",            // see FR-2 for allowed values
  "subtasksDone": 3,              // integer | null
  "subtasksTotal": 5,             // integer | null
  "codeDelivered": false,         // bool — true only if PR merged OR diff confirms delivery
  "testsPassing": null,           // bool | null — null = no signal available
  "prState": "in_review"         // "none"|"open"|"in_review"|"approved"|"merged" | null
}
```

The legacy top-level `progressPct` field **may** be retained for one release cycle as a copy of `progress.pct` to allow client migration, but must be marked deprecated in the schema.

### FR-2 — `basis` Enum & Derivation Rules

The `basis` field declares what signal drove `pct`. Allowed values and their derivation logic:

| `basis` value | Condition | `pct` formula |
|---|---|---|
| `"subtasks"` | `subtasksTotal >= 1` | `floor(subtasksDone / subtasksTotal * 100)` |
| `"pr"` | No subtasks AND a PR exists | See FR-3 — constrained values only |
| `"status"` | No subtasks, no PR | Mapped from task status field (see FR-4) |
| `"manual"` | Explicit override set by user | Use stored override value verbatim |
| `"unknown"` | None of the above signals available | `pct` must be `null` |

Priority order when multiple signals exist: `manual` → `subtasks` → `pr` → `status` → `unknown`.

### FR-3 — PR-Based Progress Must Not Emit 100

When `basis = "pr"`, allowed `pct` values are constrained to prevent premature completion signals:

| PR State | Max allowed `pct` |
|---|---|
| `"open"` | 40 |
| `"in_review"` | 70 |
| `"approved"` | 85 |
| `"merged"` AND `codeDelivered: true` | 95 |

`pct: 100` via PR basis alone is **never permitted**. Reaching 100 requires either (a) `basis = "subtasks"` with all subtasks done, (b) `basis = "manual"` with explicit override, or (c) `basis = "status"` with status = `done`/`closed` **and** `codeDelivered: true`.

### FR-4 — Status-Based Fallback Mapping

When `basis = "status"`:

| Task status | `pct` |
|---|---|
| `backlog` / `todo` | 0 |
| `in_progress` | 30 |
| `in_review` | 60 |
| `done` / `closed` with `codeDelivered: false` | 85 |
| `done` / `closed` with `codeDelivered: true` | 100 |

### FR-5 — Zero-Subtask Guard (`total = 0`)

When `subtasksTotal = 0` (or subtasks field is absent/null):

- `basis` must NOT be `"subtasks"`.
- `subtasksDone` and `subtasksTotal` are emitted as `null`.
- System falls through to `"pr"` → `"status"` → `"unknown"` hierarchy (FR-2).
- Under no circumstances may the system emit `pct: 100` via implicit subtask math on a 0/0 denominator.

### FR-6 — `codeDelivered` Signal Source

`codeDelivered: true` is set when **any** of the following are confirmed:

- Associated PR state is `"merged"` into the target branch.
- Diff-summary tool (ticket from related scope) returns a non-empty confirmed diff for the task.
- An explicit delivery event has been recorded against the task.

`codeDelivered: false` is the default when none of the above signals exist. It must never be inferred from PR existence alone.

### FR-7 — `testsPassing` Signal

- `true` — CI for the associated PR/commit reports all checks green.
- `false` — CI reports one or more failures.
- `null` — No CI signal available or CI has not run.

The field must always be present; `null` is a valid and expected value.

### FR-8 — Compact List Inclusion

The `progress` object (full shape, not a subset) must be present in compact list responses (`tasks.list`, `chats.list_tickets`). Payload size is not a justification for omitting `basis` or the boolean delivery fields; these fields are the entire value of the feature.

---

## Acceptance Criteria

| ID | Criterion |
|---|---|
| AC-1 | `tasks.get`, `tasks.list`, and `chats.list_tickets` all return a `progress` object matching the FR-1 schema; automated schema validation passes on all three endpoints. |
| AC-2 | Task 157 (or any task with `subtasksDone=0, subtasksTotal=0`) returns `progress.pct: null` and `progress.basis: "unknown"` (or falls through to `"status"`/`"pr"` if those signals exist) — never `pct: 100`. |
| AC-3 | Tasks 322 & 336 (or any task with `prState: "in_review"` and no merged code) return `progress.pct ≤ 70` and `progress.codeDelivered: false`; `pct: 100` is absent. |
| AC-4 | A task with `prState: "merged"` but `codeDelivered: false` returns `progress.pct ≤ 85`, never 100. |
| AC-5 | `pct: 100` is only emitted when at least one of these is true: all subtasks done (`basis="subtasks"`), explicit manual override, or status is terminal **and** `codeDelivered: true`. |
| AC-6 | `progress.basis` is a string from the defined enum; no other values appear in production responses. |
| AC-7 | `progress.testsPassing` is always present and is `true`, `false`, or `null` — never missing. |
| AC-8 | Existing agent/board consumers that read only the legacy `progressPct` field continue to receive it (equal to `progress.pct`) for one deprecation cycle without breaking. |
| AC-9 | A regression test fixture covers the 0/0 subtask case, the `in_review` PR case, and the merged-but-undelivered case, all asserting correct `basis` and bounded `pct`. |
| AC-10 | Schema is documented in the MCP tool manifest/spec so agents can introspect field meanings without consulting external docs. |

---

## Out of Scope

- **Backfilling historical `progressPct` values** in audit logs or event streams — only live API responses are in scope.
- **Changing how subtasks are created or structured** — this PRD only changes how existing subtask data is surfaced.
- **UI rendering implementation** — the board/UI is a consumer; this PRD defines only the API contract.
- **Diff-summary tool implementation** — referenced as a signal source (`codeDelivered`) but its own build is tracked separately (related ticket). This PRD only specifies how `deriveProgress` consumes its output.
- **Webhooks or push events** — progress breakdown is a pull/response-time concern only.
- **Per-field access control or redaction** — all consumers of the task object receive the same `progress` shape.
- **Non-MCP REST or GraphQL endpoints** — alignment of those surfaces is a follow-on task.