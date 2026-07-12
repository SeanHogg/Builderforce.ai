> **PRD** — drafted by John Coder ((V2) (Durable)) · task #644
> _Each agent that updates this PRD signs its change below._

# PRD: Suppress Premature 100% Progress Emission for PR-Only Tasks

## Problem & Goal

Tasks whose only evidence of completion is "a pull request exists" are incorrectly emitting `progressPct=100`, misleading consumers (dashboards, automation pipelines, downstream agents) into treating unmerged, potentially empty PRs as fully delivered work. This violates the intent captured in issues #615 and #618, where `progressPct=100` must reflect actual delivered code, not the mere existence of a PR artifact.

**Goal:** Enforce a gate so that `progressPct=100` is never emitted for a task whose completion basis is solely PR existence, unless verifiable delivered-code evidence is also present.

---

## Target Users / ICP Roles

| Role | Concern |
|---|---|
| **Engineering Leads** | Accurate burndown and velocity metrics; false 100% pollutes sprint reporting |
| **CI/CD Pipeline Operators** | Automated promotion gates that key off `progressPct=100` must not trigger on empty/unmerged PRs |
| **Dashboard Consumers** | Trust in progress visualisations; a task showing 100% should mean done, not "PR opened" |
| **Downstream Agents** | Any agent reading task state to decide next actions must receive truthful completion signals |

---

## Scope

This change applies to every code path that computes or emits a `progressPct` value for a task, specifically:

- The progress-calculation service / module responsible for deriving `progressPct` from task evidence.
- The event/message emitter that publishes `progressPct` updates to consumers.
- Any caching or memoisation layer that might serve a stale `progressPct=100` value.

---

## Functional Requirements

### FR-1 — Evidence Classification

The system MUST classify the evidence available for a task into at least the following categories:

| Evidence Class | Examples |
|---|---|
| `PR_ONLY` | A pull request URL/reference is recorded; no commit diff, no merge event, no deployment record |
| `CODE_DELIVERED` | Merged commits, landed diff, successful deployment artefact, or verified test passage tied to the task |
| `MIXED` | PR exists **and** at least one `CODE_DELIVERED` signal is present |

### FR-2 — Progress Cap for `PR_ONLY` Tasks

When a task's evidence class resolves to `PR_ONLY`, the system MUST cap `progressPct` at a maximum of **90** (configurable via `PROGRESS_PR_ONLY_CAP`, default `90`).

The cap MUST be enforced:
- At calculation time before any emission.
- At re-evaluation time if evidence is re-assessed.
- Regardless of any manually set override that would push the value to 100.

### FR-3 — Promotion to 100%

`progressPct=100` MAY only be set when **at least one** of the following conditions is true:

1. A merge event for the associated PR is confirmed (e.g., `merged_at` timestamp is non-null and verified against the VCS source of truth).
2. A deployment or release record linked to the task's commits is confirmed as successful.
3. A human explicit sign-off signal with role ≥ `REVIEWER` is recorded **after** a `CODE_DELIVERED` event (not before or concurrent with PR creation alone).

### FR-4 — Validation at Emission Point

The emitter MUST perform a final guard check immediately before publishing any `progressPct` value. If the computed value is `100` and the evidence class is `PR_ONLY`, the emitter MUST:

1. Downgrade the emitted value to the cap defined in FR-2.
2. Log a structured warning: `{ "event": "progress_cap_applied", "taskId": "<id>", "reason": "PR_ONLY_basis", "originalValue": 100, "cappedValue": <cap> }`.
3. NOT throw or crash; the task continues processing.

### FR-5 — Retroactive Correction

On system startup and on any evidence re-ingestion event, the system MUST re-evaluate all tasks currently stored with `progressPct=100` whose evidence class is `PR_ONLY` and apply the cap retroactively, emitting a corrected event to all subscribers.

### FR-6 — Audit Trail

Every application of the cap (FR-2, FR-4, FR-5) MUST produce an immutable audit record containing: `taskId`, `timestamp`, `previousValue`, `appliedCap`, `evidenceSnapshot`, `triggerReason`.

---

## Acceptance Criteria

| ID | Criterion |
|---|---|
| AC-1 | Given a task with only a PR reference and no merge/deploy/sign-off event, when `progressPct` is computed, then the emitted value is ≤ 90 and never 100. |
| AC-2 | Given a task with a PR reference **and** a confirmed `merged_at` timestamp, when `progressPct` is computed, then the emitted value MAY be 100. |
| AC-3 | Given a task previously stored at `progressPct=100` with `PR_ONLY` evidence, when the system restarts or re-ingests evidence, then the task is re-emitted with the capped value and an audit record is created. |
| AC-4 | Given a manual override attempting to set `progressPct=100` on a `PR_ONLY` task, when the emitter processes the override, then the value is capped, the override is not honoured at 100, and a structured warning log entry is produced. |
| AC-5 | Given a task that transitions from `PR_ONLY` to `CODE_DELIVERED` (merge event arrives), when evidence is re-evaluated, then `progressPct=100` becomes permissible and the cap is lifted without requiring a full restart. |
| AC-6 | The configurable cap value `PROGRESS_PR_ONLY_CAP` changes the ceiling applied in AC-1 and AC-4 without requiring a code deployment. |
| AC-7 | All cap-application events appear in the audit log within 5 seconds of the triggering computation. |
| AC-8 | No existing passing tests for tasks with `CODE_DELIVERED` evidence regress as a result of this change. |
| AC-9 | A unit test suite covers: `PR_ONLY` capping, `CODE_DELIVERED` promotion, retroactive correction on startup, and the structured warning log format. |

---

## Out of Scope

- Changes to how PRs are created, updated, or linked to tasks in the VCS integration layer.
- UI rendering of `progressPct` values (the cap is enforced at the data layer; UI consumes whatever value is emitted).
- Redefining what constitutes a "delivered" commit beyond the evidence signals listed in FR-3 (future evidence types are a separate epic).
- Modifying the `progressPct` scale (0–100) or introducing fractional values.
- Per-user or per-team configuration of the cap threshold (only global env-var configuration is in scope per FR-2).
- Backfilling historical analytics databases; only live task state and future events are corrected.