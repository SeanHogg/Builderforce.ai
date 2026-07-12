> **PRD** — drafted by Ada (Sr. Product Mgr) · task #223
> _Each agent that updates this PRD signs its change below._

# PRD: Low-Hanging Fruit Discovery & Quick Win Identification

## Problem & Goal

Engineering and product teams accumulate backlogs where high-value, easily-completable tasks are buried beneath noise. Tasks marked **low or medium priority** are frequently de-prioritized indefinitely, yet many represent genuine quick wins — small effort, real impact — that could ship value, reduce tech debt, or improve team morale with minimal cost.

**Goal:** Systematically surface tasks marked low or medium priority that can be completed quickly (quick wins), so teams can opportunistically batch and ship them, improving throughput and backlog hygiene without disrupting core roadmap work.

---

## Target Users / ICP Roles

| Role | Need |
|---|---|
| **Engineering Lead / Tech Lead** | Identify quick tasks to assign during sprint slack time or cooldown periods |
| **Product Manager** | Surface low-effort wins to demonstrate backlog progress to stakeholders |
| **Individual Contributor (Engineer)** | Find meaningful tasks to pick up between larger workstreams |
| **Engineering Manager** | Use quick wins for onboarding new team members or filling partial sprint capacity |

---

## Scope

This effort covers auditing the **existing task backlog** (tickets, issues, or work items) to identify and categorize items that meet the quick-win criteria. The output is an actionable, prioritized shortlist ready for assignment.

**Sources in scope:**
- All tasks currently tagged or labeled as `low priority` or `medium priority`
- Tasks in `backlog`, `to-do`, or `open` status (not in progress, not blocked)

---

## Functional Requirements

### FR-1 — Task Ingestion
- Retrieve all tasks from the backlog with priority set to `low` or `medium`
- Exclude tasks with status: `in progress`, `blocked`, `closed`, `duplicate`, or `won't fix`

### FR-2 — Quick Win Classification
Each retrieved task must be evaluated against the following quick-win heuristics:

| Signal | Criteria |
|---|---|
| **Estimated effort** | ≤ 2 story points, or explicitly labeled `S` / `XS`, or estimated ≤ 4 hours |
| **Scope clarity** | Task description contains clear, unambiguous acceptance criteria or a defined output |
| **No blocking dependencies** | Task has zero open blockers or dependent tickets |
| **No cross-team coordination required** | Assignable to a single contributor without external team approval |
| **Self-contained** | Does not require a design review, legal review, or architecture decision |

### FR-3 — Scoring & Ranking
- Assign each qualifying task a **Quick Win Score (QWS)** from 1–5 based on how many heuristics it fully satisfies
- Tasks scoring **4–5** are classified as **Tier 1 Quick Wins** (recommend immediate pickup)
- Tasks scoring **2–3** are classified as **Tier 2 Quick Wins** (recommend batching or review before pickup)
- Tasks scoring **≤ 1** are excluded from the output shortlist

### FR-4 — Output Report
Produce a structured shortlist containing for each qualifying task:
- Task ID and title
- Current priority label
- Quick Win Score (QWS) and tier
- One-line rationale for inclusion
- Recommended action (`pick up now` / `batch with sprint` / `needs clarification`)

### FR-5 — Categorization by Theme
Group output tasks into themes (e.g., `bug fix`, `developer experience`, `documentation`, `performance`, `tech debt`, `UX polish`) to allow teams to batch related work.

### FR-6 — Flagging Edge Cases
Any task that appears quick-win-eligible but contains ambiguous scope must be flagged separately with a note: `Needs clarification before pickup`.

---

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | All low and medium priority tasks in `open` / `backlog` / `to-do` status are evaluated — no eligible task is skipped |
| AC-2 | Every task in the output shortlist satisfies at least 2 of the 5 quick-win heuristics (QWS ≥ 2) |
| AC-3 | Output report is grouped by theme and sorted descending by Quick Win Score |
| AC-4 | Tasks with open blockers do not appear in the shortlist |
| AC-5 | Each shortlisted task includes a recommended action and one-line rationale |
| AC-6 | Ambiguous tasks are captured in a separate flagged list, not silently dropped |
| AC-7 | The shortlist is delivered in a human-readable format (markdown table or equivalent) consumable without additional tooling |

---

## Out of Scope

- **High-priority tasks** — these follow standard sprint planning processes
- **Tasks currently in progress** — no re-evaluation of active work
- **Effort re-estimation** — this process uses existing estimates only; it does not conduct story point re-scoring
- **Automated task assignment** — output is advisory; actual assignment remains a human decision
- **Roadmap reprioritization** — surfacing quick wins does not change the official priority label of any task
- **Cross-backlog aggregation across multiple projects** — initial scope is limited to a single backlog/project at a time
- **Reporting dashboards or persistent tooling** — this is a one-time or on-demand audit, not a continuous monitoring system