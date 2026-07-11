> **PRD** — drafted by Ada (Sr. Product Mgr) · task #143
> _Each agent that updates this PRD signs its change below._

# PRD: Delivery Tracking — Velocity, Deadlines & Trend Assessment

## Problem & Goal

Engineering and product leaders lack a consolidated, data-driven view of delivery health across active projects. Without visibility into completion rates, task aging, agent throughput, and deadline coverage, prioritization decisions are made on instinct rather than evidence. This analysis surfaces the metrics and flags needed for leaders to act confidently on resourcing, scope, and deadline-setting.

**Goal:** Produce a repeatable delivery-tracking report that quantifies velocity, exposes risk, and recommends corrective actions across all active projects.

---

## Target Users / ICP Roles

| Role | Need |
|---|---|
| Engineering / Product Leader | Portfolio-level health, trend signals, reprioritization levers |
| Project / Delivery Manager | Per-project velocity, stale tasks, blocked work |
| Agent Operators | Throughput benchmarks, backlog hygiene guidance |

---

## Scope

### In Scope

- Four active projects: **BuilderForce.AI**, **RumbleDating**, **Hired.Video**, **BurnRateOS**
- Task-level data: status, creation date, last-activity date, PR linkage, due date presence
- Completion rate calculation per project
- Task aging analysis across `backlog`, `ready`, and `in_progress` states
- Blocked and overdue task identification (verified against due dates, not just flags)
- PR merge status per task
- Agent throughput (tasks completed per week, per project)
- Trend classification: accelerating / steady / slowing
- Gap flag and recommendation when due dates are absent

### Out of Scope

- Bug severity triage or defect-rate analysis
- Individual contributor performance review
- Financial burn-rate or cost-per-task calculations
- Integration with external calendar or roadmap tools
- Real-time / live dashboard (this is a point-in-time analytical report)

---

## Functional Requirements

### FR-1 — Completion Rate Metrics

- Calculate `tasks_done / total_tasks` as a percentage for each project.
- Baseline snapshot:

| Project | Done | Total | Rate |
|---|---|---|---|
| BuilderForce.AI | 13 | 19 | 68% |
| RumbleDating | 0 | 40 | 0% |
| Hired.Video | 1 | 9 | 11% |
| BurnRateOS | 0 | 9 | 0% |

- Roll up a **portfolio completion rate** (aggregate done / aggregate total).

### FR-2 — Task Aging Analysis

- For every open task (status ≠ `done`), compute `age_days = today − created_date`.
- Group aging buckets: `0–7 days`, `8–14 days`, `15–30 days`, `>30 days`.
- For `in_progress` tasks, also compute `days_in_progress = today − status_changed_to_in_progress_date`.
- Surface tasks with **no activity in ≥ 14 days** as **stale** (see FR-4).

### FR-3 — Blocked & Overdue Task Identification

- Query for any task with status `blocked`; list with blocker reason and age.
- For tasks with a `due_date` set: flag any where `due_date < today` and status ≠ `done` as **overdue**.
- Current known state: 0 blocked, 0 overdue — report must confirm or contradict this via direct due-date comparison, not relying solely on status flags.

### FR-4 — Stale Task List

- Define stale: open task with `last_activity_date` > 14 days ago.
- Output: table with `task_id`, `project`, `title`, `status`, `age_days`, `days_since_last_activity`.
- Sort by `days_since_last_activity` descending.

### FR-5 — PR Merge Status

- For each task, check whether an associated PR exists and whether it is `merged`, `open`, or `absent`.
- Flag tasks that have an open PR but the task status is still `in_progress` (potential merge bottleneck).
- Flag tasks marked `done` with no merged PR (traceability gap).

### FR-6 — Agent Throughput

- Calculate `tasks_completed_per_week` per project using `done_date` timestamps over the trailing 4 weeks.
- Where completion history is sparse (e.g., RumbleDating, BurnRateOS), note insufficient data and report as `0 tasks/week` with a `data gap` annotation.
- Compute a **portfolio throughput** total.

### FR-7 — Trend Assessment

- Compare weekly completion counts across the trailing 4-week window.
- Classify trend per project:
  - **Accelerating**: week-over-week completions increasing ≥ 20%
  - **Steady**: week-over-week change within ±20%
  - **Slowing**: week-over-week completions decreasing ≥ 20%
  - **No Signal**: fewer than 2 data points available
- Provide a single portfolio-level trend classification.

### FR-8 — Due Date Gap Flag & Recommendation

- Confirm whether any task or project has a `due_date` set.
- If **no due dates are set** on any project or task, emit a prominent flag:

> ⚠️ **CRITICAL GAP — No due dates are set on any project or task.** Without deadlines, overdue detection, SLA tracking, and meaningful trend analysis are impossible. Recommend: assign milestone-level due dates to each project within the next sprint, then cascade to individual high-priority tasks.

- Include a recommended deadline-setting workflow (project milestone → epic → task hierarchy).

---

## Acceptance Criteria

| # | Criterion | Pass Condition |
|---|---|---|
| AC-1 | Velocity metrics per project | Completion %, avg time-to-done (where data exists), and weekly throughput reported for all 4 projects |
| AC-2 | Portfolio rollup | Single aggregate completion rate and throughput figure present |
| AC-3 | Stale task list | All open tasks with no activity ≥ 14 days listed in a sortable table |
| AC-4 | Blocked & overdue verification | Report confirms or overrides the "0 blocked, 0 overdue" baseline using actual due-date comparison |
| AC-5 | PR status coverage | Every task's PR linkage state (`merged` / `open` / `absent`) is documented; mismatches flagged |
| AC-6 | Due date gap flag | ⚠️ flag appears prominently if no due dates are set; suppressed only if dates are found |
| AC-7 | Trend classification | Each project and the portfolio receive one of: Accelerating / Steady / Slowing / No Signal |
| AC-8 | Recommendations present | At minimum: due-date hygiene recommendation, and one action per project with 0% completion |
| AC-9 | Data gaps disclosed | Any metric that cannot be computed due to missing data is labeled `[DATA GAP]` rather than omitted or defaulted to zero silently |

---

## Out of Scope

- Setting due dates on behalf of stakeholders (flagging only; execution is a leadership action)
- Modifying task statuses or reassigning work
- Analysis of projects outside the four named above
- Historical data beyond 4 weeks for throughput (unless readily available)
- Predictive completion-date modeling (future PRD)
- Qualitative assessment of task complexity or effort estimation
- Stakeholder communication drafting or status-report formatting beyond this document