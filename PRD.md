> **PRD** — drafted by John Coder ((V2) (Durable)) · task #615
> _Each agent that updates this PRD signs its change below._

# PRD: Fix Progress/Done Accounting for Doc-Only PRs

## Problem & Goal

### Problem
Tasks are being marked **done at 100%** after an agent opens a pull request containing **only documentation files** (e.g., `PRD.md`, `STYLES.md`, architecture docs) with zero implementation or test code. The board's progress percentage is computed from "a PR exists and is green" plus subtask-link counts — not from delivered implementation code or passing tests.

This produced a systematically misleading board state: tasks appear complete while no implementer has written a single line of source code. Affected tasks include #146, #157, #322, #329, #336, and #503. The root cause is that PM and Validator agents write a PRD, open a documentation PR, and the pipeline flips the task to `done` at 100%.

### Goal
Ensure that progress percentage and completion status accurately reflect **delivered implementation**, not the mere existence of a green PR. A doc-only PR must never trigger task completion or report 100% progress for a coding task.

---

## Target Users / ICP Roles

| Role | Impact |
|---|---|
| **Engineering Manager / Human Overseer** | Sees accurate board state; no longer investigates phantom completions |
| **PM Agent** | PRD PR moves task to `spec-ready`, not `done` |
| **Coder Agent** | Receives tasks in `spec-ready` state with clear implementation requirement |
| **Validator Agent** | Runs a systematic doc-only gate rather than ad-hoc flagging |
| **Brain / Orchestrator** | Routes tasks correctly based on typed deliverable and real progress signals |

---

## Scope

This PRD covers:
- The progress-percentage computation logic
- The task completion (`done`) transition gate
- The classification of tasks by deliverable type (code vs. written decision)
- The Validator agent's completion-gate check

This does **not** cover re-dispatching already-affected tasks (remediated manually) or changes to how agents generate PRDs.

---

## Functional Requirements

### FR-1 — Doc-Only PR Detection

The system must inspect the file diff of any PR associated with a task before updating progress or status.

- **Doc-only PR**: A PR whose diff contains exclusively files matching one or more of the following patterns:
  - `**/*.md`
  - `**/docs/**`
  - `**/*.rst`
  - `**/*.txt` (documentation roots only, e.g., `docs/`)
  - `CHANGELOG`, `LICENSE`, `NOTICE`, `README*`
- If **all** changed files match doc-only patterns, the PR is classified as `doc-only`.
- A PR with at least one changed file outside these patterns is classified as `has-implementation`.

### FR-2 — Progress Cap for Doc-Only PRs on Coding Tasks

For any task whose `deliverable_type` is `code` (see FR-5):

| PR Classification | Max Allowed Progress% |
|---|---|
| No PR opened | 0–30% (planning/spec work only) |
| `doc-only` PR open or merged | ≤ 20% |
| `has-implementation` PR open | 21–89% (based on test signal, see FR-3) |
| `has-implementation` PR merged, tests passing | Up to 100% |

Progress must never be set to 100% while the PR is `doc-only`, regardless of PR merge status or CI color.

### FR-3 — Implementation + Test Signal for Progress%

Progress percentage for `deliverable_type = code` tasks must be derived from:

1. **Source files changed**: At least one file changed under recognized source directories (`src/`, `lib/`, `app/`, `packages/`, language-specific roots, or any non-doc, non-config path). Required for progress > 20%.
2. **Tests present**: At least one test file changed or added (patterns: `**/*.test.*`, `**/*.spec.*`, `**/tests/**`, `**/__tests__/**`). Required for progress > 60%.
3. **Tests passing**: CI status checks on the PR head SHA report all required checks green. Required for progress = 100%.

A suggested mapping (implementer may tune thresholds):

| Condition | Progress% |
|---|---|
| Task created, no PR | 5% |
| Spec/PRD PR merged | 15% |
| Implementation PR open, source files present | 40% |
| Implementation PR open, source + test files present | 65% |
| Implementation PR open, source + tests + CI green | 85% |
| Implementation PR merged, source + tests + CI green | 100% |

### FR-4 — "Spec Ready / Needs Implementation" State

Introduce (or map to an existing) intermediate task state: **`spec-ready`**.

- When a `doc-only` PR is merged for a `deliverable_type = code` task, the task transitions to `spec-ready`, **not** `done` or `in-progress` at high %.
- `spec-ready` signals to the Brain/Orchestrator that a Coder agent must be dispatched.
- A task in `spec-ready` must not be displayed as complete on any board view.
- The `spec-ready → in-progress` transition is triggered when a Coder opens a `has-implementation` PR.

### FR-5 — Task Deliverable Type Classification

Every task must carry an explicit `deliverable_type` field. Valid values:

| Value | Meaning | May complete without code? |
|---|---|---|
| `code` | Feature, bug fix, refactor, test suite | No |
| `decision` | Architecture decision, analysis, investigation, provisioning choice | Yes — written artifact is the deliverable |
| `spec` | PRD, design doc, style guide | Yes — doc PR is the deliverable |
| `ops` | Infra provisioning, CI config, deployment | Evaluated case-by-case (may include code) |

**Rules:**
- `deliverable_type` must be set at task creation by the PM or Brain agent.
- It must not be inferred retroactively from PR content.
- Tasks of type `decision` or `spec` may reach `done` via a merged doc-only PR without triggering a gap flag.
- Tasks of type `code` or `ops` require implementation signal per FR-2/FR-3.
- Historical untyped tasks default to `code` and are subject to the doc-only gate.

### FR-6 — Systematic Validator Completion Gate

The Validator agent must run a **completion gate check** as a mandatory step before approving any `done` transition:

1. Retrieve the PR(s) linked to the task.
2. Classify each PR as `doc-only` or `has-implementation` (FR-1).
3. Retrieve the task's `deliverable_type` (FR-5).
4. **Gate logic:**
   - If `deliverable_type ∈ {code, ops}` AND all linked PRs are `doc-only` → **block `done`**, emit gap flag: `COMPLETION_BLOCKED: doc-only PR, no implementation detected`.
   - If `deliverable_type ∈ {code, ops}` AND a `has-implementation` PR exists but CI is not green → **block `done`**, emit: `COMPLETION_BLOCKED: tests not passing`.
   - If `deliverable_type ∈ {decision, spec}` → allow `done` regardless of PR content.
5. The gap flag must be written to the task's audit log and surfaced on the board (e.g., a `⚠ blocked` badge).
6. The Brain/Orchestrator must re-dispatch blocked tasks to a Coder agent, not leave them stalled.

### FR-7 — Audit Log & Observability

- Every progress% update must log: PR SHA, PR classification (`doc-only` / `has-implementation`), files-changed summary, signal conditions met, previous%, new%.
- Every blocked `done` transition must log: blocking reason, Validator agent ID, timestamp.
- Logs must be queryable by task ID for post-mortem review.

---

## Acceptance Criteria

| # | Criterion | Verification |
|---|---|---|
| AC-1 | A coding task with only a merged `*.md` PR cannot reach `done` or display 100% progress. | Integration test: create task (`type=code`), merge doc-only PR, assert status ≠ `done` and progress ≤ 20%. |
| AC-2 | Progress% for a coding task increments only when source files are present (>20%), test files are present (>60%), and CI is green (100%). | Unit tests covering each threshold boundary. |
| AC-3 | Merging a doc-only PR on a coding task transitions it to `spec-ready`, not `done`. | Integration test: assert state = `spec-ready` after doc PR merge. |
| AC-4 | A task explicitly typed `decision` or `spec` reaches `done` via a doc-only PR without triggering a gap flag. | Integration test: create `type=decision` task, merge doc PR, assert `done` and no gap flag. |
| AC-5 | The Validator blocks `done` and emits `COMPLETION_BLOCKED` for any `type=code` task whose linked PRs are all doc-only. | Unit test on gate logic; end-to-end test against a mock PR with only `.md` diffs. |
| AC-6 | `COMPLETION_BLOCKED` gap flags are written to the audit log and visible on the board within one pipeline cycle. | Manual verification + automated log-assertion test. |
| AC-7 | Tasks without an explicit `deliverable_type` default to `code` and are subject to the doc-only gate. | Unit test: untyped task → gate applied. |
| AC-8 | Tasks #146, #157, #322, #329, #336 (re-dispatched for real code) are not re-blocked by the new gate once a `has-implementation` PR is merged with green CI. | Regression test using task fixtures. |
| AC-9 | The `spec-ready` state triggers automatic Brain dispatch to a Coder agent within one orchestration cycle. | Integration test: assert Coder dispatch event emitted after `spec-ready` transition. |

---

## Out of Scope

- **Re-remediation of already-affected tasks** (#146, #157, #322, #329, #336, #503): handled manually prior to this ticket.
- **Changes to how PM or Validator agents generate PRD content** or the format of documentation files.
- **UI/board redesign**: badge and state label changes only; no new board views.
- **Retroactive re-scoring of historical closed tasks**: gate applies to tasks transitioning to `done` from the deploy date forward.
- **Code quality gates** (coverage thresholds, lint scores): out of scope for this fix; may be addressed in a follow-on ticket.
- **Non-PR delivery mechanisms** (direct commits to main, script-based deploys): not addressed here.
- **Changing CI/CD provider integration**: this PRD assumes existing CI status-check APIs remain available.