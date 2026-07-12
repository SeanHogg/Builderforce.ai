> **PRD** — drafted by John Coder ((V2) (Durable)) · task #615
> _Each agent that updates this PRD signs its change below._

# PRD: Fix Progress/Done Accounting for Doc-Only PRs

## Problem & Goal

### Problem
Tasks are being marked **done at 100% progress** after an agent opens a PR containing exclusively documentation files (`.md`, `docs/**`) with zero implementation code or tests. The board's progress heuristic treats "a green/merged PR exists" as delivery, regardless of PR content. This produces a deceptive board state: tasks appear complete while no implementation has been written.

Affected examples: tasks 146, 157, 322, 329, 336, 503 (retroactively remediated in Brain chat #58, but the systemic cause persists).

### Goal
Redefine completion and progress signals so that **only PRs carrying real implementation and/or test code can move a coding task toward done**. Doc-only PRs must gate at a distinct intermediate state. Non-coding tasks (analysis, decisions, provisioning) must be **explicitly typed** as such — never inferred from a green PR — so they can legitimately complete without code.

---

## Target Users / ICP Roles

| Role | Concern |
|------|---------|
| **PM Agent** | Must not inadvertently complete tasks by opening spec/PRD PRs |
| **Coder Agent** | Progress credit should reflect what it actually ships |
| **Validator Agent** | Needs a systematic, automated gate rather than ad-hoc manual flagging |
| **Manager Agent** | Needs reliable board state to dispatch work correctly |
| **Human Operator** | Needs a trustworthy board; should never see "100% done" for unimplemented tasks |

---

## Scope

This PRD covers:
- The **progress % calculation engine** (wherever PR diff metadata is evaluated)
- The **task state-machine** (transitions to `in-progress`, `spec-ready`, `done`)
- The **task type taxonomy** (coding vs. non-coding)
- The **Validator / Manager automated gate** that checks done tasks for implementation presence

Out-of-scope items are listed at the bottom.

---

## Functional Requirements

### FR-1 — PR Content Classification

The system **must** inspect the file diff of every PR associated with a task and classify it as one of:

| Class | Definition |
|-------|-----------|
| `docs-only` | All changed files match `**/*.md`, `docs/**/*`, `*.txt`, `CHANGELOG*`, `LICENSE*`, or other configured doc globs; zero source or test files changed |
| `impl` | At least one changed file falls under configured source directories (e.g., `src/**`, `lib/**`, `app/**`, `packages/**`) or test directories (`test/**`, `tests/**`, `**/*.test.*`, `**/*.spec.*`) |
| `mixed` | Both doc and impl files changed |

Configuration for source/doc globs must be editable in a single central config file (e.g., `pipeline.config.yaml`) without code changes.

---

### FR-2 — Progress % Signal Redefinition

Progress for a **coding task** must be computed from implementation signals, not PR existence alone:

| Signal | Weight / Logic |
|--------|---------------|
| PR opened with `impl` or `mixed` class | Unlocks progress credit |
| Source files changed (non-zero) | Contributes to progress |
| Tests present in diff | Required to exceed 80% |
| CI checks passing on impl files | Required to reach 100% |
| Subtask links resolved | Additional contribution (existing logic retained) |

A `docs-only` PR **contributes 0% implementation progress** and must not increase the task's progress counter beyond its pre-PR value.

---

### FR-3 — State Machine: New `spec-ready` State

Add a new task state between `in-progress` and `done`:

```
open → in-progress → spec-ready → in-progress (impl) → done
```

**Transitions:**

| Trigger | From | To |
|---------|------|----|
| PR opened, class = `docs-only` | `open` or `in-progress` | `spec-ready` |
| PR opened, class = `impl` or `mixed` | `open` or `in-progress` | `in-progress` |
| PR opened, class = `impl` or `mixed` | `spec-ready` | `in-progress` |
| All impl signals satisfied (FR-2) | `in-progress` | `done` |

A task in `spec-ready` must display a board label such as **"Spec Ready / Needs Implementation"** and must never display progress ≥ 50% (cap enforced).

A task can **never** transition directly from `spec-ready` → `done`.

---

### FR-4 — Task Type Taxonomy

Every task must carry an explicit `task_type` field. Supported values:

| Value | Description | Can complete without impl code? |
|-------|-------------|--------------------------------|
| `coding` | Feature, bug-fix, refactor, test authoring | No |
| `analysis` | Research spike, architectural decision | Yes — written deliverable is sufficient |
| `provisioning` | Infra, environment setup, access grants | Yes — config/infra artifacts are sufficient |
| `decision` | Formal written decision / ADR | Yes — document is the deliverable |
| `documentation` | Pure doc work explicitly scoped as such | Yes |

**Rules:**
- `task_type` must be set at task creation time by the creating agent or human.
- If `task_type` is absent, the system defaults to `coding` and logs a warning.
- Only `analysis`, `provisioning`, `decision`, and `documentation` tasks may reach `done` via a `docs-only` PR.
- `coding` tasks with a `docs-only` PR are hard-blocked from `done` (see FR-3 and FR-5).

---

### FR-5 — Systematic Validator / Manager Gate

The Validator agent and Manager agent must run a **Doc-Only Gap Check** as a mandatory step before accepting any task completion:

1. Fetch the PR diff for every PR linked to the task.
2. Classify PR content per FR-1.
3. If `task_type = coding` **and** no linked PR has class `impl` or `mixed`:
   - Reject the `done` transition.
   - Emit a structured gap event: `{ task_id, reason: "docs-only-pr", pr_url, detected_at }`.
   - Set task state back to `spec-ready` (if it was incorrectly advanced) or keep it there.
   - Notify the Manager agent to dispatch a Coder.
4. Log every gap event to a persistent audit trail (append-only).

This check must run:
- On every PR merge event for a linked PR.
- On every explicit "mark done" action by any agent or human.
- As part of the periodic board-reconciliation sweep (if one exists).

---

### FR-6 — Manager Agent Auto-Dispatch on `spec-ready`

When a coding task enters `spec-ready`, the Manager agent must automatically:
1. Detect the transition (via event or reconciliation sweep).
2. Dispatch a Coder agent with context: task ID, spec PR URL, and `task_type = coding`.
3. Record the dispatch in the task's activity log.

This replaces the manual remediation steps performed in chat #58.

---

### FR-7 — Audit & Observability

- Every progress % change must be logged with: `{ task_id, old_pct, new_pct, trigger, pr_class, timestamp }`.
- Every state transition must be logged with: `{ task_id, from_state, to_state, trigger, agent_id, timestamp }`.
- A dashboard view (or CLI query) must allow filtering tasks by `task_type`, current state, and `pr_class` of latest linked PR.

---

## Acceptance Criteria

| # | Criterion | Verification Method |
|---|-----------|-------------------|
| AC-1 | A `coding` task whose only linked PR is `docs-only` cannot reach `done` or display progress ≥ 50%; state is forced to `spec-ready`. | Automated test: open a PR with only `.md` files on a `coding` task; assert state = `spec-ready`, progress ≤ 49%. |
| AC-2 | Progress % for a `coding` task reaches 100% only when: an `impl`-class PR exists, source files are changed, tests are present in the diff, and CI passes. | Automated test: create a PR with impl + tests + green CI; assert progress = 100%, state = `done`. |
| AC-3 | A `docs-only` PR on a `coding` task transitions state to `spec-ready`, not `in-progress` or `done`. | Automated test: assert state machine output. |
| AC-4 | `analysis`, `provisioning`, `decision`, and `documentation` task types can reach `done` via a `docs-only` PR without triggering the gap check. | Automated test: mark an `analysis` task with a `docs-only` PR as done; assert no gap event emitted, state = `done`. |
| AC-5 | The Validator gap check fires on every PR merge and every "mark done" action for `coding` tasks, and emits a structured gap event when no impl PR exists. | Integration test: merge a `docs-only` PR; assert gap event appears in audit log within one reconciliation cycle. |
| AC-6 | A `coding` task entering `spec-ready` triggers Manager auto-dispatch of a Coder agent within one reconciliation cycle. | Integration test: assert dispatch record in task activity log after `spec-ready` transition. |
| AC-7 | All progress and state-transition events are logged with the required fields (see FR-7). | Log schema validation test. |
| AC-8 | Source/doc glob configuration is editable in `pipeline.config.yaml` without code changes, and classification respects the updated globs. | Config-change test: add a custom glob; assert classification changes accordingly. |
| AC-9 | Tasks 146, 157, 322, 329, 336, 503 (if re-created in the system) would not have been auto-completed under the new rules. | Regression test using recorded PR diffs from those tasks. |
| AC-10 | A task with missing `task_type` defaults to `coding`, and a warning is logged. | Unit test: create task without `task_type`; assert default and warning. |

---

## Out of Scope

- **Retroactive correction of historical tasks** — manual remediation for tasks 146, 157, 322, 329, 336, 503 is already complete (chat #58); this PRD does not re-litigate those.
- **Changes to CI/CD pipeline internals** — this PRD consumes CI pass/fail signals; it does not redefine how CI runs.
- **PR quality scoring** (code coverage thresholds, linting grades) — progress gating is binary on impl presence + CI green, not coverage %.
- **Human-authored PRs bypassing agent rules** — human overrides are out of scope for v1; a follow-on access-control PRD may address them.
- **Multi-repo or monorepo path remapping** — glob config covers single-repo layouts; complex monorepo source-root remapping is deferred.
- **UI/board redesign** — state labels (`spec-ready`) are surfaced through existing board rendering; no new UI components are required beyond the label string.