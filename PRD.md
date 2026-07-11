> **PRD** — drafted by Ada (Sr. Product Mgr) · task #191
> _Each agent that updates this PRD signs its change below._

# PRD: Bug & Regression Catalog — Non-Done Tasks

## Problem & Goal

Engineering and product teams lack a consolidated, up-to-date view of all in-flight bug and regression work items. Without this catalog, triage is inconsistent, duplicates go undetected, and high-severity regressions can stall dependent work silently. The goal is to produce a definitive, structured list of every non-done task that represents a bug or regression, enabling prioritized remediation and clear ownership.

---

## Target Users / ICP Roles

| Role | Need |
|---|---|
| Engineering Lead / Tech Lead | Prioritize and assign bug/regression work; unblock dependent tasks |
| Product Manager | Assess release readiness; communicate risk to stakeholders |
| QA / SDET | Verify coverage and avoid duplicate test efforts |
| Individual Contributors | Understand which bugs are active and who owns them |

---

## Scope

Catalog all tasks that meet **both** conditions:

1. **Status is not "Done"** — includes any status such as: `Open`, `In Progress`, `Blocked`, `In Review`, `Todo`, `Pending`, `On Hold`, etc.
2. **Task type is a bug or regression** — identified by any of the following signals:
   - Task title contains keywords: `fix`, `bug`, `regression`, `broken`, `error`, `failure`, `crash`, `defect`, `patch`, `hotfix`
   - Task is explicitly labeled/tagged as `bug` or `regression`
   - Task number matches known exemplars: #62 (Regression), #57 (Fix the build), #90 (Fix the build), #66 (Fix agent execution)

---

## Functional Requirements

### FR-1 — Task Discovery
- The catalog agent **must** scan all available task/issue sources (e.g., project board, backlog, sprint columns) for tasks in non-done statuses.
- The agent **must not** include tasks whose status is `Done`, `Closed`, `Resolved`, `Cancelled`, or equivalent.

### FR-2 — Bug/Regression Classification
- Each discovered task **must** be evaluated against the classification signals defined in Scope.
- Tasks that match one or more signals **must** be included in the catalog.
- Tasks that match no signals **must** be excluded.
- Ambiguous tasks (borderline title, no label) **must** be flagged for human review rather than silently excluded.

### FR-3 — Catalog Structure
Each catalog entry **must** capture the following fields:

| Field | Description |
|---|---|
| `task_id` | Unique task/issue number or identifier |
| `title` | Full task title |
| `status` | Current workflow status |
| `type` | `bug` \| `regression` \| `ambiguous` |
| `severity` | `critical` \| `high` \| `medium` \| `low` \| `unknown` |
| `assignee` | Current owner (or `unassigned`) |
| `linked_tasks` | IDs of blocked or related tasks |
| `source_signal` | Which classification signal triggered inclusion |
| `notes` | Any additional context (e.g., duplicate suspicion, stale status) |

### FR-4 — Duplicate Detection
- The agent **must** flag tasks with identical or near-identical titles (e.g., #57 and #90 both titled "Fix the build") as **potential duplicates** and note both IDs in each entry.

### FR-5 — Severity Tagging
- If a task has an existing severity or priority label, that value **must** be preserved.
- If no severity exists, the agent **must** infer severity using the following heuristic and mark it as `inferred`:
  - `critical` — blocks a release, CI/CD pipeline, or core execution path (e.g., build failures, agent execution failures)
  - `high` — degrades a primary feature or affects multiple users
  - `medium` — degrades a secondary feature or has a known workaround
  - `low` — cosmetic, edge case, or minor inconvenience

### FR-6 — Output Delivery
- The final catalog **must** be delivered as a structured artifact (Markdown table + JSON sidecar).
- The Markdown table **must** be sortable by `severity` (critical first) and then by `task_id` ascending.
- The JSON sidecar **must** be machine-readable for downstream automation.

### FR-7 — Known Seed Tasks
The following tasks are confirmed in-scope and **must** appear in the catalog regardless of automated signal matching:

| Task ID | Title | Rationale |
|---|---|---|
| #62 | Regression | Explicitly named regression |
| #57 | Fix the build | Build breakage = blocking regression |
| #90 | Fix the build | Potential duplicate of #57 |
| #66 | Fix agent execution | Core execution path defect |

---

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | All four seed tasks (#62, #57, #90, #66) appear in the catalog with fully populated fields. |
| AC-2 | No task with status `Done`, `Closed`, `Resolved`, or `Cancelled` appears in the catalog. |
| AC-3 | Tasks #57 and #90 are flagged as potential duplicates of each other. |
| AC-4 | Every catalog entry includes a `source_signal` value explaining why it was classified as a bug/regression. |
| AC-5 | Tasks with ambiguous classification are listed in a separate **"Flagged for Review"** section rather than omitted. |
| AC-6 | Severity is populated for every entry; inferred severities are marked as `(inferred)`. |
| AC-7 | The Markdown output is sorted: `critical` → `high` → `medium` → `low` → `unknown`, then ascending `task_id` within each group. |
| AC-8 | A valid JSON sidecar file is produced alongside the Markdown catalog. |
| AC-9 | The catalog run is idempotent — re-running against the same data produces the same output. |

---

## Out of Scope

- **Resolving or closing** any bug/regression task — this PRD covers cataloging only, not remediation.
- **Creating new tasks** for undocumented bugs discovered during cataloging — these should be reported separately via normal bug-filing process.
- **Historical/done tasks** — completed bugs and regressions are explicitly excluded.
- **Root cause analysis** — the catalog captures what exists, not why bugs occurred.
- **Automated fix generation** — no code patches or PR creation.
- **Task management system migrations** — the catalog reads from existing sources without modifying them.
- **Prioritization decisions** — the catalog surfaces severity signals; humans make final prioritization calls.