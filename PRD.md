> **PRD** — drafted by John Coder ((V2) (Durable)) · task #644
> _Each agent that updates this PRD signs its change below._

# PRD: Restrict `progressPct=100` Emission When Basis Is Only a PR Existing

## Problem & Goal

`progressPct=100` is currently being emitted for tasks where the sole basis for completion is the existence of a pull request, with no verified delivered/merged code. This causes false "done" signals that mislead downstream consumers (dashboards, dependent task schedulers, stakeholder reports) into treating a task as complete when meaningful work has not yet landed. Issues #615 and #618 surface real cases where this incorrect signal caused downstream failures.

**Goal:** Ensure `progressPct=100` is never emitted for a task whose completion basis is exclusively "a PR exists" — the code must be verifiably delivered (e.g., PR merged, commit landed in the target branch, artifact published) before a task may report 100% progress.

---

## Target Users / ICP Roles

| Role | How They Are Affected |
|---|---|
| **Platform / Infra Engineers** | Consume `progressPct` to gate deployments and dependent job triggers; false 100% causes premature promotion. |
| **Engineering Managers / Tech Leads** | Read progress dashboards; a stuck-open PR showing 100% masks real delivery risk. |
| **Downstream Automation / Agents** | Any agent or CI step that polls `progressPct=100` as a start condition will fire incorrectly. |
| **Contributors submitting PRs** | Must understand that opening a PR will no longer auto-complete a task. |

---

## Scope

This change affects:

- The **progress calculation / emission layer** — the component that decides what value to assign `progressPct` and when to emit it.
- The **basis-evaluation logic** — the rules engine / classifier that determines *why* a task is considered complete.
- **Event payloads** carrying `progressPct` (internal event bus, webhook output, API responses).
- **Tests and fixtures** that currently assert `progressPct=100` against PR-only states.

---

## Functional Requirements

### FR-1 — Enumerate Valid Bases for `progressPct=100`

A task MUST only reach `progressPct=100` when **at least one** of the following verified delivery signals is present:

| Signal ID | Description |
|---|---|
| `MERGED` | The PR/MR has been merged into the target branch. |
| `COMMIT_LANDED` | A qualifying commit SHA is reachable from the target branch HEAD. |
| `ARTIFACT_PUBLISHED` | A release artifact (package, container image, binary) is confirmed published to the target registry/feed. |
| `DEPLOY_CONFIRMED` | A deployment event confirms the code is running in the intended environment. |
| `MANUAL_OVERRIDE` | An authorised user has explicitly marked delivery confirmed with a recorded rationale. |

A PR in any non-merged state (`open`, `draft`, `closed-unmerged`, `review-in-progress`) does **not** satisfy any of the above signals.

### FR-2 — Cap Progress When Only a PR Exists

When the **only** available basis signals for a task are PR-existence signals (`PR_OPENED`, `PR_READY_FOR_REVIEW`, `PR_APPROVED`) and no FR-1 signal is present, the progress calculation MUST NOT return a value of `100`.

The maximum permissible value in this state is `99` (or the system's configured pre-delivery ceiling — see FR-5).

### FR-3 — Re-evaluate on PR State Change

The progress value MUST be re-evaluated and a new event emitted whenever the PR state changes (e.g., PR merged → triggers re-evaluation → `progressPct=100` now permitted if FR-1 is satisfied).

### FR-4 — Basis Metadata in Emitted Events

Every emitted progress event MUST include a `basis` field listing the signal(s) that determined the current `progressPct`. This allows consumers to audit why 100% was or was not emitted.

```jsonc
{
  "taskId": "task-xyz",
  "progressPct": 99,
  "basis": ["PR_APPROVED"],
  "deliverySignals": [],
  "timestamp": "2024-11-01T12:00:00Z"
}
```

### FR-5 — Configurable Pre-Delivery Ceiling

A configuration key `progress.preDeliveryCeiling` (default: `99`) MUST allow operators to set the maximum `progressPct` value allowed when no FR-1 delivery signal is confirmed. Valid range: `0–99`.

### FR-6 — Backward-Compatibility / Migration

Existing tasks that currently hold `progressPct=100` with a PR-only basis MUST be re-evaluated on the next progress event trigger. If no FR-1 signal is found, they MUST be downgraded to the configured ceiling value and a `PROGRESS_CORRECTED` event emitted with the prior value recorded.

### FR-7 — Observability

- A structured log entry at `WARN` level MUST be written whenever a `progressPct=100` emission is blocked due to PR-only basis.
- A metric counter `progress.blocked_100_pr_only` MUST be incremented each time FR-2 blocks emission.

---

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | A task with only `PR_OPENED` signal emits `progressPct ≤ 99`. |
| AC-2 | A task with only `PR_APPROVED` (but not merged) emits `progressPct ≤ 99`. |
| AC-3 | A task with `MERGED` signal emits `progressPct = 100`. |
| AC-4 | A task with `COMMIT_LANDED` signal emits `progressPct = 100`. |
| AC-5 | A task with `ARTIFACT_PUBLISHED` signal emits `progressPct = 100`. |
| AC-6 | Setting `progress.preDeliveryCeiling = 95` caps a PR-only task at `95`, not `99`. |
| AC-7 | When a previously-100 PR-only task is re-evaluated, a `PROGRESS_CORRECTED` event is emitted and the task's stored `progressPct` is updated to ≤ 99. |
| AC-8 | Every emitted progress event contains a non-empty `basis` array. |
| AC-9 | The `progress.blocked_100_pr_only` metric counter increments on each blocked emission. |
| AC-10 | All pre-existing unit and integration tests pass; tests that asserted `progressPct=100` for PR-only fixtures are updated to assert `≤ 99`. |
| AC-11 | A `MANUAL_OVERRIDE` by an authorised user results in `progressPct=100` regardless of PR state. |

---

## Out of Scope

- Changes to PR creation, review, or merge workflows in source control systems.
- Modifications to task *status* fields (e.g., `DONE`, `IN_REVIEW`) — this PRD concerns `progressPct` only.
- UI/dashboard rendering changes (those teams may consume the corrected events independently).
- Defining the authorisation model for `MANUAL_OVERRIDE` (pre-existing RBAC applies).
- Retroactive historical data correction beyond the next event trigger (no bulk backfill job).
- Support for non-PR delivery mechanisms not listed in FR-1 (can be added in a follow-on).