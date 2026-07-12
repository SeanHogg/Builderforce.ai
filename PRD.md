> **PRD** — drafted by Ada (Sr. Product Mgr) · task #670
> _Each agent that updates this PRD signs its change below._

# PRD: Update Task Completion Logic

## Problem & Goal

The system currently emits `progressPct=100` when a pull request (PR) exists, even when no code has actually been delivered (e.g., merged or deployed). This produces a false signal of task completion, misleading downstream consumers—dashboards, automation pipelines, stakeholders—into believing work is done when it is only in review. The goal is to ensure `progressPct=100` is only emitted when code delivery is confirmed, not merely when a PR has been opened.

---

## Target Users / ICP Roles

| Role | Interest |
|---|---|
| **Engineering Managers** | Accurate progress reporting; no premature "done" signals on sprint boards |
| **Developers / Agents** | Clear, trustworthy feedback on task state from the system |
| **CI/CD & Automation Pipelines** | Reliable `progressPct` values to trigger downstream deployment or notification steps |
| **Product / Program Managers** | Honest completion metrics for planning and stakeholder reporting |

---

## Scope

This change targets the **task progress calculation and emission layer**—specifically the logic that maps task state to a `progressPct` value. It does **not** redesign the broader task model or PR lifecycle.

---

## Functional Requirements

### FR-1 — Redefine "Complete" State
`progressPct=100` **must not** be emitted unless at least one of the following delivery signals is confirmed:

| Delivery Signal | Definition |
|---|---|
| `merged` | The PR has been merged into the target branch |
| `deployed` | The artifact/commit has been deployed to a tracked environment |
| `delivered` | An explicit `delivered` flag or event has been set on the task |

### FR-2 — PR-Only State Mapping
When a task has an associated PR but **none** of the delivery signals in FR-1 are present, the system **must** emit a `progressPct` value strictly less than 100. The recommended default is **90**, representing "in review / pending merge," but the exact value must be configurable per project or org.

### FR-3 — Backward Compatibility Guard
Existing tasks that previously reached `progressPct=100` via PR-only state **must** be re-evaluated on next read/recalculation. If the delivery signal is absent, their emitted value must be corrected to the PR-only cap (FR-2) until a valid delivery signal is present.

### FR-4 — Audit / Event Log
Every state transition that previously would have emitted `progressPct=100` but is now capped must be recorded in the event log with:
- `task_id`
- `previous_emitted_value` (100)
- `new_emitted_value` (capped value)
- `reason` ("no_delivery_signal")
- `timestamp`

### FR-5 — Configuration
Expose a configurable threshold for the PR-only maximum progress value (default: 90). Configuration must be settable at the **organization** level and overridable at the **project** level. Valid range: 1–99 (inclusive).

---

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | A task with only an open PR emits `progressPct < 100`; default value is **90**. |
| AC-2 | A task with a **merged** PR emits `progressPct = 100`. |
| AC-3 | A task with a **deployed** artifact emits `progressPct = 100`. |
| AC-4 | A task with an explicit `delivered` flag emits `progressPct = 100`. |
| AC-5 | Existing tasks previously capped at 100 (PR-only) are corrected on next recalculation and do **not** continue to emit 100. |
| AC-6 | The PR-only cap value is configurable (org and project level) and accepts only integers 1–99. |
| AC-7 | All capped transitions are recorded in the audit/event log with the required fields. |
| AC-8 | No regression: tasks with confirmed delivery signals continue to emit `progressPct = 100`. |
| AC-9 | Unit tests cover: PR-only, merged, deployed, delivered, and mixed states. |
| AC-10 | API consumers receive the corrected value; no client-side patching is required. |

---

## Out of Scope

- Redesigning the PR lifecycle model or webhook integration layer.
- Changing what events constitute a PR being "opened" or "closed" (non-merged).
- UI/dashboard visual redesign beyond reflecting the corrected `progressPct` value.
- Modifying `progressPct` semantics for tasks with **no PR** at all (existing logic unchanged).
- Real-time push of corrections to already-emitted events in external systems (corrections apply on next read/recalculation only).
- Multi-PR or stacked-PR resolution strategies (deferred to a follow-on initiative).

## Requirements

_Owned by the business-analyst — to be authored._

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._